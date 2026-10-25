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

const LESSON_ID_RE = /^[a-z0-9-]+$/;
const MAX_SECONDS = 600;

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- panels

function grownUpPanel() {
  applyToDocument({ safe_mode: true, animations: true, contrast: 'normal', animation_speed: 1 });
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, 'This app needs a grown-up.'),
    el('p', {}, 'Ask a grown-up to open Act 1 from your apps page.'),
    el('a', { class: 'next', href: '/parent' }, 'Back to my apps')));
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
      u.lang = 'en-US';
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
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  if (!childId) {
    grownUpPanel();
    return;
  }

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
  const queue = [];             // failed POST bodies, retried on the next success
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
  function post(body) {
    return api('/api/progress', { method: 'POST', body }).catch(() => { queue.push(body); });
  }
  async function flushQueue() {
    while (queue.length) {
      const body = queue.shift();
      try { await api('/api/progress', { method: 'POST', body }); } catch { queue.unshift(body); break; }
    }
  }
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
    const settingsBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings for grown-ups', 'aria-haspopup': 'dialog' }, gear, 'Settings');
    settingsBtn.addEventListener('click', () => panel.toggle());
    return el('header', { class: 'topbar' },
      el('div', {},
        el('h1', { class: 'lesson-title' }, `Lesson ${lesson.order}: ${lesson.title}`),
        el('div', { class: 'progress', 'aria-label': 'Progress' },
          el('span', {}, `${view.progress.index + 1} of ${view.progress.total}`),
          el('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(view.progress.total), 'aria-valuenow': String(view.progress.index) },
            fill))),
      settingsBtn);
  }

  function promptRow(view) {
    const replay = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hear it again' }, svgLike('speaker'));
    replay.addEventListener('click', () => { speech.unlocked = true; speech.speak(view.audio); });
    const feedback = el('p', { class: 'feedback', id: 'feedback' },
      state.status === 'wrong' ? 'Try again.' : state.status === 'correct' ? 'Yes!' : '');
    if (showGuide && state.status === 'correct') feedback.textContent = `Yes! ${GUIDE_NAME} is happy.`;
    const slot = showGuide ? guide.el : el('div', { class: 'companion-slot is-empty', 'aria-hidden': 'true' });
    return el('section', { class: `prompt-row${showGuide ? ' has-guide' : ''}` },
      slot,
      el('div', {}, el('p', { class: 'prompt', id: 'prompt' }, view.prompt), feedback),
      replay);
  }

  function choiceButton(c, { pressed = false, revealCorrect = false, disabled = false, onClick } = {}) {
    const pic = svgNode(c.svg);
    const btn = el('button', {
      type: 'button', class: `choice${revealCorrect ? ' is-correct-reveal' : ''}`,
      'data-choice': c.id, 'aria-pressed': pressed ? 'true' : 'false', disabled,
      'aria-describedby': 'prompt',
    }, pic, el('span', { class: 'label' }, c.label));
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
    const tray = el('div', { class: 'tray', role: 'group', 'aria-label': 'Things to move' });
    const placedBox = el('div', { class: 'placed', 'aria-live': 'polite' });
    const zoneLabel = el('span', { class: 'zone-label' },
      state.revealAnswer ? `Put ${view.target.count} in the ${view.target.zone.replace(/-/g, ' ')}.` : `${placed.length} in the ${view.target.zone.replace(/-/g, ' ')}`);
    const zone = el('div', { class: 'drop-zone', role: 'button', tabindex: '0', 'aria-label': `The ${view.target.zone.replace(/-/g, ' ')}. Tap to put the chosen thing here.` },
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
        back.setAttribute('aria-label', `${c.label}, in the ${view.target.zone.replace(/-/g, ' ')}. Tap to take it out.`);
        placedBox.append(back);
        continue;
      }
      const item = choiceButton(c, { pressed: selectedDragId === c.id, disabled: locked, onClick: () => { selectedDragId = selectedDragId === c.id ? null : c.id; render(false); } });
      item.classList.add('drag-item');
      item.setAttribute('aria-label', `${c.label}. Tap to choose, then tap the ${view.target.zone.replace(/-/g, ' ')}.`);
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
    const slots = el('div', { class: 'slots', role: 'group', 'aria-label': 'Your order' },
      view.choices.map((_, i) => {
        const id = picks[i];
        const c = id ? view.choices.find((x) => x.id === id) : null;
        const wrong = state.revealAnswer && state.highlight === i;
        return el('div', { class: `slot${c ? ' is-filled' : ''}${wrong ? ' is-wrong' : ''}`, 'aria-label': c ? `${i + 1}: ${c.label}` : `${i + 1}: empty` },
          c ? svgNode(c.svg) : String(i + 1));
      }));
    const row = el('div', { class: 'choices', 'data-count': String(view.choices.length), role: 'group', 'aria-labelledby': 'prompt' },
      view.choices.map((c) => choiceButton(c, {
        pressed: picks.includes(c.id),
        disabled: locked || picks.includes(c.id),
        onClick: () => { if (picks.length < view.choices.length) { picks = [...picks, c.id]; render(false); } },
      })));
    const clearBtn = el('button', { type: 'button', class: 'text-btn', disabled: locked || picks.length === 0 }, 'Start over');
    clearBtn.addEventListener('click', () => { picks = []; if (state.revealAnswer) dispatch({ type: 'RETRY' }); else render(false); });
    return el('div', { class: 'sequence-area' }, slots, row, clearBtn);
  }

  function bottomBar(view) {
    const mode = view.mode;
    const correct = state.status === 'correct';
    let label = 'Next';
    let enabled = correct && !rewarding;
    let onClick = () => dispatch({ type: 'NEXT' });
    if (!correct && mode === 'drag') {
      label = 'Check'; enabled = picks.length > 0;
      onClick = () => dispatch({ type: 'ANSWER', answer: { count: picks.length } });
    } else if (!correct && mode === 'sequence') {
      label = 'Check'; enabled = picks.length === view.choices.length;
      onClick = () => dispatch({ type: 'ANSWER', answer: [...picks] });
    }
    if (correct && state.stepIndex === currentLesson(state).steps.length - 1) label = 'Finish';
    const next = el('button', { type: 'button', class: 'next', disabled: !enabled }, label);
    next.addEventListener('click', onClick);
    const retry = state.revealAnswer && mode === 'tap'
      ? el('button', { type: 'button', class: 'text-btn left' }, 'Try again')
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
      speech.speak(view.audio);
      setTimeout(() => guide.setState('listen'), 1500);
    }
  }

  function renderComplete() {
    const lesson = currentLesson(state);
    const nextId = state.nextLessonId;
    const stepsDone = lesson.steps.length;
    const nextBtn = nextId
      ? el('button', { type: 'button', class: 'next' }, 'Next lesson')
      : el('a', { class: 'next', href: '/parent' }, 'All done');
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
      el('header', { class: 'topbar' }, el('h1', { class: 'lesson-title' }, `Lesson ${lesson.order}: ${lesson.title}`)),
      el('section', { class: 'panel' },
        showGuide ? celebrationRow(completedCount) : null,
        el('h2', {}, 'You did it!'),
        el('p', {}, `${stepsDone} of ${stepsDone} done.`),
        arrival ? el('p', { class: 'arrival' }, arrival) : null,
        nextBtn));
    speech.speak(arrival ? `You did it! ${arrival}` : 'You did it!');
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
