// Act 1 shell: the only module that touches the DOM for the lesson screen.
//
// It dispatches actions to engine/state.js and reflects the state it gets
// back. It never decides what happens next (the reducer advances steps), never
// draws an effect the reward plan did not ask for, and never trusts a child
// id from anywhere but the gate's <meta name="child-id">.
//
// Layout is identical on every task: title + progress + settings at the top,
// prompt + replay in the same box, 2-4 big choices in a fixed grid, one
// affordance at the bottom center. Nothing moves unless the child moves it.

import { api, ApiError } from '/js/api.js';
import { el, replace } from '/js/ui.js';
import { CANONICAL_ORDER } from '../engine/lesson.js';
import { initialState, reduce, currentLesson, currentStep, unlockedIds } from '../engine/state.js';
import { createRewardPlayer } from './reward-player.js';
import { createSettingsPanel, resolveInitial, readLocal, applyToDocument, APP_ID, readGuidePref, writeGuidePref } from './settings-panel.js';
import { svgNode } from './svg-dom.js';
import { createCompanion, preloadGuide, celebrationRow, arrivalLine, GUIDE_NAME } from './companion.js';
import { initI18n, t, tr, speechLang } from '/js/i18n.js';
import { enqueue, flush as flushOffline, queueLength } from './offline-queue.js';

const LESSON_ID_RE = /^[a-z0-9-]+$/;
const MAX_SECONDS = 600;

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- panels

function grownUpPanel() {
  applyToDocument({ safe_mode: true, animations: true, contrast: 'normal', animation_speed: 1 });
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, t('act1.grownup_heading')),
    el('p', {}, t('act1.grownup_body')),
    el('a', { class: 'next', href: '/parent' }, t('act1.back_to_my_apps'))));
}

// Offline (Phase 5): the service worker caches the shell, the lessons, the
// sprites and the last good settings/progress answers; progress that cannot
// be posted waits in IndexedDB (offline-queue.js). Registration failing is
// not an error the child should see: the app simply needs the network.
function registerServiceWorker(childId) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      // First visit: the page loaded before the worker took control, so ask
      // it to cache this gate page and the two boot answers now.
      const target = reg.active || navigator.serviceWorker.controller;
      if (!target) return;
      const id = encodeURIComponent(childId);
      target.postMessage({ type: 'warm', urls: [
        location.pathname + location.search,
        `/api/children/${id}/settings?app_id=${APP_ID}`,
        `/api/children/${id}/progress?app_id=${APP_ID}`,
      ] });
    })
    .catch(() => { /* no offline support here */ });
}

// ---------------------------------------------------------------- speech

const speech = {
  unlocked: false,
  onSpeaking: null, // (bool) => void, set by the app so the guide can mouth along
  speak(text) {
    if (!this.unlocked || !('speechSynthesis' in globalThis) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLang(); // spoken audio follows the UI language
      u.rate = 0.9;
      u.onstart = () => this.onSpeaking && this.onSpeaking(true);
      u.onend = () => this.onSpeaking && this.onSpeaking(false);
      u.onerror = () => this.onSpeaking && this.onSpeaking(false);
      speechSynthesis.speak(u);
    } catch { /* no voices available */ }
  },
  stop() {
    try { if ('speechSynthesis' in globalThis) speechSynthesis.cancel(); } catch { /* ignore */ }
  },
};

// ---------------------------------------------------------------- boot

async function boot() {
  await initI18n().catch(() => { /* English strings are built in as the fallback */ });
  document.title = t('act1.title');
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  if (!childId) {
    grownUpPanel();
    return;
  }
  registerServiceWorker(childId);

  let settingsRow;
  let progress;
  try {
    [settingsRow, progress] = await Promise.all([
      api(`/api/children/${encodeURIComponent(childId)}/settings?app_id=${APP_ID}`),
      api(`/api/children/${encodeURIComponent(childId)}/progress?app_id=${APP_ID}`),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    grownUpPanel();
    return;
  }

  const settings = resolveInitial(settingsRow, readLocal(), settingsRow.is_default ? null : settingsRow.updated_at || null);
  applyToDocument(settings);

  const completed = progress.lessons.filter((l) => l.completed).map((l) => l.lesson_id);
  const unlocked = Array.isArray(progress.unlocked) && progress.unlocked.length ? progress.unlocked : [CANONICAL_ORDER[0]];
  const startId = unlocked.find((id) => !completed.includes(id)) || unlocked[unlocked.length - 1];
  const row = progress.lessons.find((l) => l.lesson_id === startId);
  const startStep = row && !row.completed ? row.step_index : 0;

  const app = createApp({ childId, settings, completed });
  await app.start(startId, startStep);
}

// ---------------------------------------------------------------- app

function createApp({ childId, settings: initialSettings, completed }) {
  // The curriculum catalogue: every id in canonical order, with the real
  // module filled in as it is loaded. Only the current lesson is downloaded.
  const loaded = new Map();
  const catalogue = () => CANONICAL_ORDER.map((id) => loaded.get(id) || { id, title: '', steps: [] });

  let state = null;
  let stepShownAt = 0;
  let settings = { ...initialSettings };
  const reported = new Set();   // `${lessonId}:${stepId}` already POSTed
  let queued = 0;               // bodies waiting in IndexedDB (shown as a badge)
  let picks = [];               // sequence mode picks / drag mode placed ids
  let selectedDragId = null;    // tap-fallback for drag
  let rewarding = false;        // true while a task reward plays; Next waits
  // The guide character. Shown unless the adult turns it off on this device
  // (a device preference, not a child setting: nothing about the child is stored).
  let showGuide = readGuidePref();
  const guide = createCompanion({ animationsOn: () => settings.animations !== false && !prefersReducedMotion });
  speech.onSpeaking = (on) => guide.setSpeaking(on);
  if (showGuide) preloadGuide();

  const player = createRewardPlayer({ root: document.body, settings, prefersReducedMotion });
  const panel = createSettingsPanel({
    childId,
    initial: settings,
    onChange(next) {
      settings = next;
      player.setSettings(next);
      if (state) dispatch({ type: 'SET_SETTINGS', settings: next });
    },
    onTestSound() { player.unlockAudio(); player.testTone(); },
    guideShown: showGuide,
    onToggleGuide(on) {
      showGuide = on;
      writeGuidePref(on);
      render(false);
    },
  });
  document.body.append(panel.panel);

  // First real gesture anywhere unlocks audio and speech for the session.
  function unlockOnce() {
    player.unlockAudio();
    speech.unlocked = true;
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  }
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  async function loadLesson(id) {
    if (!LESSON_ID_RE.test(id) || !CANONICAL_ORDER.includes(id)) throw new Error('unknown lesson');
    if (loaded.has(id)) return loaded.get(id);
    const mod = await import(`../lessons/${id}.js`);
    // Lesson 01 has a combined-cue step set; the adult's switch picks it.
    // The lesson object keeps the shared render/check; only steps differ.
    const lesson = settings.coloured_shapes === true && Array.isArray(mod.colouredSteps)
      ? Object.freeze({ ...mod.default, steps: mod.colouredSteps })
      : mod.default;
    loaded.set(id, lesson);
    return lesson;
  }

  async function start(lessonId, stepIndex) {
    try {
      await loadLesson(lessonId);
      state = initialState({ lessonId, stepIndex, settings, lessons: catalogue(), completed });
    } catch {
      grownUpPanel();
      return;
    }
    render(true);
  }

  // ---- progress reporting (never interrupts the child)
  // A failed POST (offline, or the server is down) goes to the IndexedDB
  // queue and is retried in order when the browser says it is online again.
  const send = (body) => api('/api/progress', { method: 'POST', body });
  async function post(body) {
    try {
      await send(body);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 0 || status >= 500) {
        await enqueue(body).catch(() => { /* no IndexedDB: this step is lost, the child is not */ });
        await refreshQueued();
      }
    }
  }
  async function flushQueue() {
    try {
      await flushOffline(send);
    } catch { /* still offline */ }
    await refreshQueued();
  }
  async function refreshQueued() {
    const n = await queueLength().catch(() => 0);
    if (n !== queued) { queued = n; render(false); }
  }
  window.addEventListener('online', () => { flushQueue(); });
  window.addEventListener('offline', () => render(false));
  flushQueue();
  function secondsOnStep() {
    return Math.max(0, Math.min(MAX_SECONDS, Math.round((Date.now() - stepShownAt) / 1000)));
  }
  function reportStep(lesson, step, index, completedLesson) {
    const key = `${lesson.id}:${step.id}${completedLesson ? ':done' : ''}`;
    if (reported.has(key)) return;
    reported.add(key);
    const body = {
      child_id: childId, app_id: APP_ID, lesson_id: lesson.id,
      step_index: index, completed: completedLesson, seconds: secondsOnStep(),
    };
    flushQueue().finally(() => post(body));
  }

  // ---- dispatch with side effects
  async function dispatch(action) {
    if (!state) return;
    const next = reduce(state, action);
    if (next === state) return;
    const prev = state;
    state = next;

    if (action.type === 'ANSWER') {
      if (state.status === 'correct') {
        const lesson = currentLesson(state);
        const step = currentStep(state);
        reportStep(lesson, step, state.stepIndex, false);
        guide.setState('happy');
        rewarding = true;
        render(false);
        const snapshot = state;
        await player.play('task');
        rewarding = false;
        // Only redraw if nothing else happened while the reward played.
        if (state === snapshot) render(false);
        return;
      }
      render(false);
      shakeChoice(action);
      guide.setState('nod');
      return;
    }

    if (action.type === 'NEXT') {
      if (state.lessonComplete) {
        const lesson = currentLesson(state);
        reportStep(lesson, lesson.steps[state.stepIndex], state.stepIndex, true);
        guide.setState('cheer');
        renderComplete();
        await player.play('lesson');
        return;
      }
      render(true);
      return;
    }

    if (action.type === 'JUMP' || action.type === 'RETRY' || action.type === 'SET_SETTINGS') {
      render(prev.lessonId !== state.lessonId || prev.stepIndex !== state.stepIndex);
    }
  }

  function shakeChoice(action) {
    if (settings.animations === false || prefersReducedMotion) return;
    const id = typeof action.answer === 'string' ? action.answer : null;
    if (!id) return;
    const node = main.querySelector(`.choice[data-choice="${CSS.escape(id)}"]`);
    if (!node) return;
    node.classList.remove('shake');
    void node.offsetWidth; // restart the one-shot animation
    node.classList.add('shake');
    node.addEventListener('animationend', () => node.classList.remove('shake'), { once: true });
  }

  // ---------------------------------------------------------------- render

  function topbar(lesson, view) {
    const pct = view.progress.total ? Math.round(((view.progress.index) / view.progress.total) * 100) : 0;
    const gear = svgLike('gear');
    const fill = el('span');
    fill.style.width = `${pct}%`; // CSSOM, not a style attribute: the CSP has no unsafe-inline
    const settingsBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('act1.settings_label'), 'aria-haspopup': 'dialog' }, gear, t('act1.settings'));
    settingsBtn.addEventListener('click', () => panel.toggle());
    // A quiet badge for the adult: offline, or steps saved on this device.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const badge = offline || queued > 0
      ? el('span', { class: 'offline-badge', role: 'status' }, offline ? t('act1.offline_badge') : t('act1.saved_on_device'))
      : null;
    return el('header', { class: 'topbar' },
      el('div', {},
        el('h1', { class: 'lesson-title' }, t('act1.lesson_title', { order: lesson.order, title: tr(lesson.title) })),
        el('div', { class: 'progress', 'aria-label': t('act1.progress') },
          el('span', {}, t('act1.step_of', { index: view.progress.index + 1, total: view.progress.total })),
          badge,
          el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(view.progress.total), 'aria-valuenow': String(view.progress.index) },
            fill))),
      settingsBtn);
  }

  function promptRow(view) {
    const replay = el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('act1.hear_again') }, svgLike('speaker'));
    replay.addEventListener('click', () => { speech.unlocked = true; speech.speak(tr(view.audio)); });
    const feedback = el('p', { class: 'feedback', id: 'feedback' },
      state.status === 'wrong' ? t('act1.try_again') : state.status === 'correct' ? t('act1.yes') : '');
    if (showGuide && state.status === 'correct') feedback.textContent = t('act1.guide_happy', { guide: GUIDE_NAME });
    const slot = showGuide ? guide.el : el('div', { class: 'companion-slot is-empty', 'aria-hidden': 'true' });
    return el('section', { class: `prompt-row${showGuide ? ' has-guide' : ''}` },
      slot,
      el('div', {}, el('p', { class: 'prompt', id: 'prompt' }, tr(view.prompt)), feedback),
      replay);
  }

  function choiceButton(c, { pressed = false, revealCorrect = false, disabled = false, onClick } = {}) {
    const pic = svgNode(c.svg);
    const btn = el('button', {
      type: 'button', class: `choice${revealCorrect ? ' is-correct-reveal' : ''}`,
      'data-choice': c.id, 'aria-pressed': pressed ? 'true' : 'false', disabled,
      'aria-describedby': 'prompt',
    }, pic, el('span', { class: 'label' }, tr(c.label)));
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function tapArea(view) {
    const locked = state.status === 'correct';
    const grid = el('div', { class: 'choices', 'data-count': String(view.choices.length), role: 'group', 'aria-labelledby': 'prompt' },
      view.choices.map((c) => choiceButton(c, {
        revealCorrect: state.revealAnswer && state.highlight === c.id,
        disabled: locked,
        onClick: () => dispatch({ type: 'ANSWER', answer: c.id }),
      })));
    return grid;
  }

  function dragArea(view) {
    const locked = state.status === 'correct';
    const placed = picks; // ids placed in the zone, in order
    const zoneName = tr(view.target.zone.replace(/-/g, ' '));
    const tray = el('div', { class: 'tray', role: 'group', 'aria-label': t('act1.things_to_move') });
    const placedBox = el('div', { class: 'placed', 'aria-live': 'polite' });
    const zoneLabel = el('span', { class: 'zone-label' },
      state.revealAnswer ? t('act1.put_in', { count: view.target.count, zone: zoneName }) : t('act1.in_zone', { count: placed.length, zone: zoneName }));
    const zone = el('div', { class: 'drop-zone', role: 'button', tabindex: '0', 'aria-label': t('act1.zone_label', { zone: zoneName }) },
      svgNode(view.target.zone), placedBox, zoneLabel);

    function place(id) {
      if (locked || placed.includes(id)) return;
      picks = [...placed, id];
      selectedDragId = null;
      render(false);
    }
    function unplace(id) {
      if (locked) return;
      picks = placed.filter((p) => p !== id);
      render(false);
    }

    for (const c of view.choices) {
      if (placed.includes(c.id)) {
        const back = choiceButton(c, { disabled: locked, onClick: () => unplace(c.id) });
        back.classList.add('drag-item');
        back.setAttribute('aria-label', t('act1.in_zone_item', { label: tr(c.label), zone: zoneName }));
        placedBox.append(back);
        continue;
      }
      const item = choiceButton(c, { pressed: selectedDragId === c.id, disabled: locked, onClick: () => { selectedDragId = selectedDragId === c.id ? null : c.id; render(false); } });
      item.classList.add('drag-item');
      item.setAttribute('aria-label', t('act1.choose_then', { label: tr(c.label), zone: zoneName }));
      attachPointerDrag(item, c.id, zone, place);
      tray.append(item);
    }

    zone.addEventListener('click', () => { if (selectedDragId) place(selectedDragId); });
    zone.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && selectedDragId) { e.preventDefault(); place(selectedDragId); } });

    return el('div', { class: 'drag-area' }, tray, zone);
  }

  // Real pointer drag with a tap fallback already on the same button. Both
  // produce the same placement; the engine only ever sees { count }.
  function attachPointerDrag(item, id, zone, place) {
    let dragging = false;
    let startX = 0; let startY = 0; let moved = false;
    item.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true; moved = false; startX = e.clientX; startY = e.clientY;
      item.setPointerCapture(e.pointerId);
    });
    item.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX; const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 8) return;
      moved = true;
      item.classList.add('is-dragging');
      item.style.transform = `translate(${dx}px, ${dy}px)`;
      zone.classList.toggle('is-over', overZone(e, zone));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      const wasOver = moved && overZone(e, zone);
      item.classList.remove('is-dragging');
      item.style.transform = '';
      zone.classList.remove('is-over');
      if (wasOver) { e.preventDefault(); place(id); }
    };
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
  }
  function overZone(e, zone) {
    const r = zone.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function sequenceArea(view) {
    const locked = state.status === 'correct';
    const slots = el('div', { class: 'slots', role: 'group', 'aria-label': t('act1.your_order') },
      view.choices.map((_, i) => {
        const id = picks[i];
        const c = id ? view.choices.find((x) => x.id === id) : null;
        const wrong = state.revealAnswer && state.highlight === i;
        return el('div', { class: `slot${c ? ' is-filled' : ''}${wrong ? ' is-wrong' : ''}`, 'aria-label': c ? t('act1.slot_filled', { n: i + 1, label: tr(c.label) }) : t('act1.slot_empty', { n: i + 1 }) },
          c ? svgNode(c.svg) : String(i + 1));
      }));
    const row = el('div', { class: 'choices', 'data-count': String(view.choices.length), role: 'group', 'aria-labelledby': 'prompt' },
      view.choices.map((c) => choiceButton(c, {
        pressed: picks.includes(c.id),
        disabled: locked || picks.includes(c.id),
        onClick: () => { if (picks.length < view.choices.length) { picks = [...picks, c.id]; render(false); } },
      })));
    const clearBtn = el('button', { type: 'button', class: 'text-btn', disabled: locked || picks.length === 0 }, t('act1.start_over'));
    clearBtn.addEventListener('click', () => { picks = []; if (state.revealAnswer) dispatch({ type: 'RETRY' }); else render(false); });
    return el('div', { class: 'sequence-area' }, slots, row, clearBtn);
  }

  function bottomBar(view) {
    const mode = view.mode;
    const correct = state.status === 'correct';
    let label = t('act1.next');
    let enabled = correct && !rewarding;
    let onClick = () => dispatch({ type: 'NEXT' });
    if (!correct && mode === 'drag') {
      label = t('act1.check'); enabled = picks.length > 0;
      onClick = () => dispatch({ type: 'ANSWER', answer: { count: picks.length } });
    } else if (!correct && mode === 'sequence') {
      label = t('act1.check'); enabled = picks.length === view.choices.length;
      onClick = () => dispatch({ type: 'ANSWER', answer: [...picks] });
    }
    if (correct && state.stepIndex === currentLesson(state).steps.length - 1) label = t('act1.finish');
    const next = el('button', { type: 'button', class: 'next', disabled: !enabled }, label);
    next.addEventListener('click', onClick);
    const retry = state.revealAnswer && mode === 'tap'
      ? el('button', { type: 'button', class: 'text-btn left' }, t('act1.retry'))
      : el('span', { class: 'left' });
    if (retry.tagName === 'BUTTON') retry.addEventListener('click', () => dispatch({ type: 'RETRY' }));
    return el('footer', { class: 'bottom' }, retry, next, el('span', { class: 'right' }));
  }

  function render(newStep) {
    if (!state) return;
    applyToDocument(settings);
    const lesson = currentLesson(state);
    const step = currentStep(state);
    const total = lesson.steps.length;
    const view = lesson.render(step, { index: state.stepIndex, total, settings, isFirst: state.stepIndex === 0, isLast: state.stepIndex === total - 1 });

    if (newStep) {
      picks = [];
      selectedDragId = null;
      stepShownAt = Date.now();
      player.stop();
    }

    const area = view.mode === 'drag' ? dragArea(view) : view.mode === 'sequence' ? sequenceArea(view) : tapArea(view);
    replace(main, topbar(lesson, view), promptRow(view), area, bottomBar(view));

    if (newStep) {
      guide.setState('point');
      speech.speak(tr(view.audio));
      setTimeout(() => guide.setState('listen'), 1500);
    }
  }

  function renderComplete() {
    const lesson = currentLesson(state);
    const nextId = state.nextLessonId;
    const stepsDone = lesson.steps.length;
    const nextBtn = nextId
      ? el('button', { type: 'button', class: 'next' }, t('act1.next_lesson'))
      : el('a', { class: 'next', href: '/parent' }, t('act1.all_done'));
    if (nextId) {
      nextBtn.addEventListener('click', async () => {
        nextBtn.disabled = true;
        try {
          await loadLesson(nextId);
          const done = [...state.completed];
          if (!unlockedIds(catalogue(), done).includes(nextId)) throw new Error('locked');
          state = initialState({ lessonId: nextId, stepIndex: 0, settings, lessons: catalogue(), completed: done });
          render(true);
        } catch {
          grownUpPanel();
        }
      });
    }
    const completedCount = state.completed.length;
    const arrival = showGuide ? arrivalLine(completedCount) : null;
    replace(main,
      el('header', { class: 'topbar' }, el('h1', { class: 'lesson-title' }, t('act1.lesson_title', { order: lesson.order, title: tr(lesson.title) }))),
      el('section', { class: 'panel' },
        showGuide ? celebrationRow(completedCount) : null,
        el('h2', {}, t('act1.you_did_it')),
        el('p', {}, t('act1.done_of', { done: stepsDone })),
        arrival ? el('p', { class: 'arrival' }, tr(arrival)) : null,
        nextBtn));
    speech.speak(arrival ? `${t('act1.you_did_it')} ${tr(arrival)}` : t('act1.you_did_it'));
  }

  return { start };
}

// Two tiny inline icons for the chrome. Drawn here, not from the lesson
// library, so a lesson picture never doubles as a control.
function svgLike(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('fill', 'currentColor');
  if (name === 'speaker') {
    p.setAttribute('d', 'M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.3v2.1a5.5 5.5 0 0 1 0 10.4v2.1a7.5 7.5 0 0 0 0-14.6z');
  } else {
    p.setAttribute('d', 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3H9l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 1.7 1L9 21h6l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z');
  }
  svg.append(p);
  return svg;
}

boot();
