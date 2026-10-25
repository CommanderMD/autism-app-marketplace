// Emotion Matcher shell: the only module that touches the DOM for the game.
//
// It dispatches actions to engine/game.js and draws the itemView descriptor
// it gets back. It never decides whether an answer is right, never trusts a
// child id from anywhere but the gate's <meta name="child-id">, and never
// writes progress under any app id but the engine's literal 'emotion-match'.
//
// One question at a time: the prompt (with a replay button), then three
// choices. A wrong pick reveals the right face with a neutral "this one";
// the child moves on with "Next" when ready. No timer, no score, no streak.
// Nothing is spoken until the child's first tap.
//
// Reused from the family: settings resolution, applyToDocument and getAppId
// (act1/js/settings-panel.js), the safe-mode reward player, the guide's
// celebration row (act1/js/companion.js), the offline progress queue, and
// /js/i18n.js for every visible and spoken string.

import { api, ApiError } from '/js/api.js';
import { el, replace } from '/js/ui.js';
import { initI18n, t, speechLang, languageSwitcher } from '/js/i18n.js';
import { DEFAULT_SETTINGS, resolveInitial, applyToDocument, getAppId } from '/apps/act1/js/settings-panel.js';
import { createRewardPlayer } from '/apps/act1/js/reward-player.js';
import { celebrationRow } from '/apps/act1/js/companion.js';
import { enqueue, flush as flushOffline } from '/apps/act1/js/offline-queue.js';
import {
  APP_ID, TASK_MODES, INTENSITY_MODES, MAX_SECONDS,
  initialState, reduce, newSeed, normaliseDials, progressPayload, itemView,
} from '../engine/game.js';
import { faceSvg, sceneSvg } from '../engine/faces.js';

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Task type and intensity are the grown-up's dials. The settings API has no
// columns for them, so they live on this device, like Word Builder's dials.
const DIALS_KEY = 'emotion-match.dials.v1';
function readDials() {
  try {
    return normaliseDials(JSON.parse(localStorage.getItem(DIALS_KEY) || 'null'));
  } catch {
    return normaliseDials(null);
  }
}
function writeDials(d) {
  try { localStorage.setItem(DIALS_KEY, JSON.stringify({ task: d.task, intensity: d.intensity })); } catch { /* this page only */ }
}

// ---------------------------------------------------------------- speech

const speech = {
  unlocked: false,
  volume: 1,
  speak(text) {
    if (!this.unlocked || !('speechSynthesis' in globalThis) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLang();
      u.rate = 0.9;
      u.volume = this.volume;
      speechSynthesis.speak(u);
    } catch { /* no voices available */ }
  },
};

// The face library is frozen and self-authored (no scripts, no hrefs), and a
// DOMParser document is inert, so parsing it runs nothing.
const parser = new DOMParser();
function svgNode(markup) {
  if (!markup) return null;
  const root = parser.parseFromString(markup, 'text/html').body.querySelector('svg');
  return root ? document.importNode(root, true) : null;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${name}`);
  const p = document.createElementNS(ns, 'path');
  if (name === 'check') {
    p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '3');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else {
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.3v2.1a5.5 5.5 0 0 1 0 10.4v2.1a7.5 7.5 0 0 0 0-14.6z');
  }
  svg.append(p);
  return svg;
}

const word = (id) => t(`emotionMatch.word.${id}`);
const amount = (id) => t(`emotionMatch.amount.${id}`);

// ---------------------------------------------------------------- boot

function grownUpPanel() {
  applyToDocument(DEFAULT_SETTINGS);
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, t('emotionMatch.grownup_heading')),
    el('p', {}, t('emotionMatch.grownup_body')),
    el('a', { class: 'action', href: '/parent' }, t('emotionMatch.back_to_my_apps'))));
}

async function boot() {
  await initI18n().catch(() => { /* English is the fallback */ });
  document.title = t('emotionMatch.title');
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  // getAppId() reads the gate's meta; it must say emotion-match. Anything else
  // (including settings-panel's Act 1 fallback on an ungated page) stops here,
  // so this page can never read or write another app's rows.
  if (!childId || getAppId() !== APP_ID) {
    grownUpPanel();
    return;
  }

  // A failed read is not the child's problem: play on with the defaults
  // (safe mode on) from type 1.
  let settings = { ...DEFAULT_SETTINGS };
  let completed = [];
  const id = encodeURIComponent(childId);
  try {
    const [row, progress] = await Promise.all([
      api(`/api/children/${id}/settings?app_id=${APP_ID}`),
      api(`/api/children/${id}/progress?app_id=${APP_ID}`),
    ]);
    settings = resolveInitial(row, null, row.is_default ? null : row.updated_at || null);
    completed = (progress.lessons || []).filter((l) => l.completed).map((l) => l.lesson_id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
  }
  applyToDocument(settings);
  createGame({ childId, settings, completed });
}

// ---------------------------------------------------------------- game

function createGame({ childId, settings: initialSettings, completed }) {
  const screen = document.getElementById('screen');
  const announcer = document.getElementById('announcer');
  const grownups = document.getElementById('grownups');
  document.getElementById('title').textContent = t('emotionMatch.title');

  let settings = { ...initialSettings };
  let state = initialState({ dials: readDials(), completed, seed: newSeed() });
  let lastPostAt = Date.now();
  let message = '';
  let finished = false; // "Done" pressed: the goodbye screen

  speech.volume = Math.max(0, Math.min(1, Number(settings.volume ?? 60) / 100));
  const player = createRewardPlayer({ root: document.body, settings, prefersReducedMotion });

  function unlockOnce() {
    player.unlockAudio();
    speech.unlocked = true;
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  }
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  // ---- progress: one POST per base answer; never interrupts the child.
  const send = (body) => api('/api/progress', { method: 'POST', body });
  async function post(body) {
    try {
      await send(body);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 0 || status >= 500) {
        await enqueue(body).catch(() => { /* no IndexedDB: this answer is lost, the child is not */ });
      }
    }
  }
  const flushQueue = () => flushOffline(send).catch(() => { /* still offline */ });
  window.addEventListener('online', flushQueue);
  flushQueue();

  function report(answer) {
    const now = Date.now();
    const seconds = Math.min(MAX_SECONDS, (now - lastPostAt) / 1000);
    lastPostAt = now;
    post(progressPayload({ childId, ...answer, seconds }));
  }

  // ---- announcer: polite, emptied first so a repeat is still read.
  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  }

  // ---- text for the current question. Visible and spoken forms come from
  // the item's prompt and audio keys; no English lives in this file.
  function promptText(v) {
    if (v.layer === 'intensity') return t(v.prompt, { amount: amount(v.amount), word: word(v.word) });
    if (v.word) return t(v.prompt, { word: word(v.word) });
    return t(v.prompt);
  }
  function spokenText(v) {
    if (v.layer === 'intensity') return t(v.audio, { amount: amount(v.amount), word: word(v.word) });
    if (v.scenario) return `${t(v.audio)} ${t(v.prompt)}`;
    if (v.word) return t(v.audio, { word: word(v.word) });
    // Type 1: the word choices are read too, so every label is speakable.
    const words = v.choices.map((c) => word(c.id));
    return `${t(v.audio)} ${words.slice(0, -1).join(', ')} ${t('emotionMatch.or')} ${words[words.length - 1]}.`;
  }
  const announcedText = (v) => (v.scenario ? `${t(v.scenario)} ${promptText(v)}` : promptText(v));

  // The emotion (and, for intensity, the amount) a choice shows. Only used
  // once the answer is revealed.
  const choiceName = (c) => (c.intensity
    ? t('emotionMatch.named_intensity', { amount: amount(c.intensity), word: word(c.emotion) })
    : word(c.emotion));

  // ---- grown-ups panel
  const panel = createPanel();
  grownups.textContent = t('emotionMatch.settings');
  grownups.hidden = false;
  grownups.setAttribute('aria-expanded', 'false');
  grownups.addEventListener('click', () => panel.toggle());
  main.append(panel.el);

  // ---- dispatch with side effects
  function dispatch(action) {
    const prev = state;
    const next = reduce(state, action);
    if (next === prev) return;
    state = next;
    const v = itemView(state);

    if (action.type === 'PICK') {
      if (state.answer) report(state.answer);
      const right = v.choices.find((c) => c.correct);
      const name = choiceName(right);
      message = state.result === 'correct' ? t('emotionMatch.yes', { name }) : t('emotionMatch.this_one');
      const spoken = state.result === 'correct' ? message : t('emotionMatch.this_one_spoken', { name });
      render();
      screen.querySelector('.next')?.focus();
      announce(spoken);
      speech.speak(spoken);
      return;
    }

    // Intensity on/off keeps the current question: redraw, say nothing.
    if (action.type === 'DIALS' && state.queue === prev.queue) { render(); return; }

    message = '';
    if (state.phase === 'done') {
      render();
      screen.querySelector('.celebration .action')?.focus();
      announce(`${t('emotionMatch.done_heading')} ${t('emotionMatch.done_body', { total: v.total })}`);
      speech.speak(t('emotionMatch.done_heading'));
      player.play('lesson');
      return;
    }
    // A new question: draw it, then say it. The child asked for it (Next,
    // Again, or a dial), so speaking now is not autoplay.
    if (action.type === 'AGAIN' || action.type === 'DIALS') { player.stop(); lastPostAt = Date.now(); }
    render();
    screen.querySelector('.choice')?.focus();
    announce(announcedText(v));
    speech.speak(spokenText(v));
  }

  // ---------------------------------------------------------------- render

  function render() {
    applyToDocument(settings);
    panel.refresh();
    if (finished) { renderBye(); return; }
    const v = itemView(state);
    main.dataset.view = v.phase === 'done' ? 'done' : 'question';
    if (v.phase === 'done') renderDone(v);
    else renderQuestion(v);
  }

  function renderQuestion(v) {
    const hear = el('button', { type: 'button', class: 'icon-btn hear', 'aria-label': t('emotionMatch.hear_again') }, icon('speaker'));
    hear.addEventListener('click', () => { speech.unlocked = true; speech.speak(spokenText(v)); });

    const cue = [];
    if (v.face) cue.push(el('div', { class: 'big-face' }, svgNode(faceSvg(v.face))));
    if (v.scenario) {
      cue.push(el('figure', { class: 'scene' }, svgNode(sceneSvg(v.scene))));
      cue.push(el('p', { class: 'scenario' }, t(v.scenario)));
    }

    // Accessible names. Before the reveal a face choice is named only by its
    // position ("Choice 2"), so a screen reader cannot hear the answer before
    // the child chooses; its drawn features are described (aria-describedby)
    // without naming the emotion. Word choices (type 1) are named by position
    // plus their word - the word is the question being asked, not a leak.
    // After the reveal every choice says its emotion, and for intensity
    // questions its amount too ("Choice 3: very angry").
    const choices = v.choices.map((c) => {
      const descId = `face-desc-${c.n}`;
      let label;
      if (c.revealed) label = t('emotionMatch.choice_named', { n: c.n, name: choiceName(c) });
      else if (c.kind === 'word') label = t('emotionMatch.choice_word', { n: c.n, word: word(c.id) });
      else label = t('emotionMatch.choice_n', { n: c.n });

      const body = c.kind === 'word'
        ? [el('span', { class: 'choice-word' }, word(c.id))]
        : [svgNode(faceSvg(c.face)),
          el('span', { class: 'visually-hidden', id: descId }, t(`emotionMatch.face.${c.face}`)),
          c.revealed ? el('span', { class: 'choice-name', 'aria-hidden': 'true' }, choiceName(c)) : null];
      const b = el('button', {
        type: 'button',
        class: `choice choice-${c.kind}${c.correct ? ' is-answer' : ''}`,
        'data-choice': c.id,
        'aria-label': label,
        'aria-describedby': c.kind === 'face' ? descId : null,
        'aria-pressed': c.picked ? 'true' : 'false',
        'aria-disabled': c.revealed ? 'true' : null,
      }, c.correct ? el('span', { class: 'answer-mark', 'aria-hidden': 'true' }, icon('check')) : null, ...body);
      b.addEventListener('click', () => { if (!c.revealed) dispatch({ type: 'PICK', id: c.id }); });
      return b;
    });

    const parts = [
      el('p', { class: 'position' }, t('emotionMatch.position', { n: v.position, total: v.total })),
      ...cue,
      el('div', { class: 'prompt-line' }, el('h2', { id: 'prompt' }, promptText(v)), hear),
      el('div', { class: `choice-grid choice-grid-${v.kind}`, role: 'group', 'aria-labelledby': 'prompt' }, choices),
      el('p', { class: 'feedback', 'data-result': v.result || '' }, message),
    ];
    if (v.phase === 'revealed') {
      const next = el('button', { type: 'button', class: 'action next' }, t('emotionMatch.next'));
      next.addEventListener('click', () => dispatch({ type: 'NEXT' }));
      parts.push(next);
    }
    replace(screen, el('section', { class: `question type-${v.type}`, 'data-layer': v.layer, 'aria-labelledby': 'prompt' }, parts));
  }

  function renderDone(v) {
    const again = el('button', { type: 'button', class: 'action' }, t('emotionMatch.again'));
    again.addEventListener('click', () => dispatch({ type: 'AGAIN', seed: newSeed() }));
    const done = el('button', { type: 'button', class: 'action secondary' }, t('emotionMatch.done'));
    done.addEventListener('click', () => {
      finished = true;
      player.stop();
      render();
      screen.querySelector('.action')?.focus();
      announce(t('emotionMatch.bye'));
    });
    replace(screen, el('section', { class: 'celebration', 'aria-labelledby': 'celebration-title' },
      celebrationRow(0),
      el('h2', { id: 'celebration-title' }, t('emotionMatch.done_heading')),
      el('p', {}, t('emotionMatch.done_body', { total: v.total })),
      v.nextTimeNew ? el('p', { class: 'note' }, t('emotionMatch.next_time_new')) : null,
      el('div', { class: 'choices' }, again, done)));
  }

  function renderBye() {
    main.dataset.view = 'bye';
    const again = el('button', { type: 'button', class: 'action' }, t('emotionMatch.again'));
    again.addEventListener('click', () => { finished = false; dispatch({ type: 'AGAIN', seed: newSeed() }); });
    replace(screen, el('section', { class: 'celebration' }, el('h2', {}, t('emotionMatch.bye')), again));
  }

  // ---------------------------------------------------------------- grown-ups

  // For the adult. Task type and intensity are device-only (see DIALS_KEY);
  // contrast and safe mode are this app's server settings, PUT under
  // getAppId() exactly as the Act 1 panel does. Picks are shown here and
  // nowhere else.
  function createPanel() {
    const note = el('p', { class: 'save-note', role: 'status', 'aria-live': 'polite' });
    const tries = el('p', { class: 'tries' });
    const open = el('p', { class: 'note' });

    function radios(name, values, current, labelKey, onPick) {
      return values.map((v) => {
        const id = `em-${name}-${v}`;
        const input = el('input', { type: 'radio', name: `em-${name}`, id, value: String(v) });
        input.checked = v === current;
        input.addEventListener('change', () => { if (input.checked) onPick(v); });
        return el('div', { class: 'check' }, input, el('label', { for: id }, t(`${labelKey}${v}`)));
      });
    }
    const setDials = (patch) => {
      const dials = { ...state.dials, ...patch };
      writeDials(dials);
      finished = false;
      dispatch({ type: 'DIALS', dials, seed: newSeed() });
      api_.refresh();
    };

    const taskSet = el('fieldset', {}, el('legend', {}, t('emotionMatch.task_level')),
      radios('task', TASK_MODES, state.dials.task, 'emotionMatch.task_', (v) => setDials({ task: v })));
    const intensitySet = el('fieldset', {}, el('legend', {}, t('emotionMatch.intensity_level')),
      radios('intensity', INTENSITY_MODES, state.dials.intensity, 'emotionMatch.intensity_', (v) => setDials({ intensity: v })));

    function putSetting(patch) {
      settings = { ...settings, ...patch };
      applyToDocument(settings);
      note.textContent = '';
      api(`/api/children/${encodeURIComponent(childId)}/settings`, { method: 'PUT', body: { app_id: getAppId(), ...patch } })
        .then(() => { note.textContent = t('settings.saved'); })
        .catch(() => { note.textContent = t('emotionMatch.not_saved'); });
    }
    const contrastSet = el('fieldset', {}, el('legend', {}, t('settings.contrast')),
      radios('contrast', ['normal', 'high'], settings.contrast === 'high' ? 'high' : 'normal', 'settings.contrast_',
        (v) => putSetting({ contrast: v })));
    const safe = el('input', { type: 'checkbox', id: 'em-safe' });
    safe.checked = settings.safe_mode !== false;
    safe.addEventListener('change', () => putSetting({ safe_mode: safe.checked === true }));

    const close = el('button', { type: 'button', class: 'text-btn' }, t('settings.close'));
    const aside = el('aside', { class: 'settings-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'em-settings-title', hidden: true },
      el('h2', { id: 'em-settings-title' }, t('emotionMatch.settings_heading')),
      taskSet,
      intensitySet,
      el('p', { class: 'note' }, t('emotionMatch.dials_note')),
      tries,
      open,
      contrastSet,
      el('div', { class: 'row' },
        el('div', { class: 'check' }, safe, el('label', { for: 'em-safe' }, t('settings.safe'))),
        el('p', { class: 'note' }, t('settings.safe_note'))),
      el('div', { class: 'row' }, languageSwitcher({ visible: true }), el('p', { class: 'note' }, t('settings.language_note'))),
      note,
      close);

    const api_ = {
      el: aside,
      refresh() {
        tries.textContent = t('emotionMatch.tries', { n: state.attempts, right: state.rightFirst, answered: state.answered });
        open.textContent = t('emotionMatch.open_types', { n: state.unlocked });
      },
      open() { aside.hidden = false; grownups.setAttribute('aria-expanded', 'true'); api_.refresh(); aside.querySelector('input')?.focus(); },
      close() { aside.hidden = true; grownups.setAttribute('aria-expanded', 'false'); grownups.focus(); },
      toggle() { if (aside.hidden) api_.open(); else api_.close(); },
    };
    close.addEventListener('click', () => api_.close());
    return api_;
  }

  // First draw: the first question, silent until the child taps.
  render();
  announce(announcedText(itemView(state)));
}

boot();
