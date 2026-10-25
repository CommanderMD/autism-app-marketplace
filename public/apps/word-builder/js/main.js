// Word Builder shell: the only module that touches the DOM for the game.
//
// It dispatches actions to engine/game.js and draws the descriptors it gets
// back (listView, ladderView, exampleSteps). It never decides whether a word
// is right, never trusts a child id from anywhere but the gate's
// <meta name="child-id">, and never writes progress under any app id but the
// engine's literal 'word-builder'.
//
// Screens: the ladder list, a ladder being built, and the read-only "show me
// how" walk-through. The child taps tiles; there is no keyboard to type on,
// no submit button, no timer and no score. Nothing is spoken until the
// child's first tap, and nothing moves unless the child moves it.
//
// Reused from the family: settings resolution, applyToDocument and getAppId
// (act1/js/settings-panel.js), the safe-mode reward player, the guide's
// celebration row (act1/js/companion.js), the offline progress queue, and
// /js/i18n.js for every visible and spoken string.

import { api, ApiError } from '/js/api.js';
import { el, replace } from '/js/ui.js';
import { initI18n, t, tr, speechLang, languageSwitcher } from '/js/i18n.js';
import { DEFAULT_SETTINGS, resolveInitial, applyToDocument, getAppId } from '/apps/act1/js/settings-panel.js';
import { createRewardPlayer } from '/apps/act1/js/reward-player.js';
import { celebrationRow } from '/apps/act1/js/companion.js';
import { enqueue, flush as flushOffline } from '/apps/act1/js/offline-queue.js';
import {
  APP_ID, CLUE_LEVELS, HINT_LEVELS, DEFAULT_DIALS, MAX_SECONDS,
  ladderById, initialState, reduce, placedWord, solvedCount, newSeed,
  progressPayload, listView, ladderView, exampleSteps,
} from '../engine/game.js';
import { EXAMPLE_LADDER } from '../engine/ladders.js';

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Clue difficulty and hint level are the grown-up's dials. The settings API
// has no columns for them, so they live on this device, like the guide
// preference in Act 1. Nothing about the child is stored with them.
const DIALS_KEY = 'word-builder.dials.v1';
function readDials() {
  try {
    const raw = JSON.parse(localStorage.getItem(DIALS_KEY) || 'null');
    return {
      clue: CLUE_LEVELS.includes(raw?.clue) ? raw.clue : DEFAULT_DIALS.clue,
      hint: HINT_LEVELS.includes(raw?.hint) ? raw.hint : DEFAULT_DIALS.hint,
    };
  } catch {
    return { ...DEFAULT_DIALS };
  }
}
function writeDials(d) {
  try { localStorage.setItem(DIALS_KEY, JSON.stringify({ clue: d.clue, hint: d.hint })); } catch { /* this page only */ }
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

// Chrome icons. Shapes carry state alongside the words, never colour alone.
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${name}`);
  const p = document.createElementNS(ns, 'path');
  const stroke = (d) => {
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '3');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  };
  if (name === 'check') stroke('M5 12.5l4.5 4.5L19 7.5');
  else if (name === 'lock') stroke('M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z');
  else if (name === 'arrow') { p.setAttribute('fill', 'currentColor'); p.setAttribute('d', 'M6 4l12 8-12 8z'); }
  else if (name === 'down') { p.setAttribute('fill', 'currentColor'); p.setAttribute('d', 'M4 6h16l-8 12z'); }
  else if (name === 'ring') stroke('M12 4a8 8 0 1 0 0.01 0');
  else {
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.3v2.1a5.5 5.5 0 0 1 0 10.4v2.1a7.5 7.5 0 0 0 0-14.6z');
  }
  svg.append(p);
  return svg;
}

const hidden = (text) => el('span', { class: 'visually-hidden' }, text);

// ---------------------------------------------------------------- boot

function grownUpPanel() {
  applyToDocument(DEFAULT_SETTINGS);
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, t('wordBuilder.grownup_heading')),
    el('p', {}, t('wordBuilder.grownup_body')),
    el('a', { class: 'action', href: '/parent' }, t('wordBuilder.back_to_my_apps'))));
}

async function boot() {
  await initI18n().catch(() => { /* English is the fallback */ });
  document.title = t('wordBuilder.title');
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  // getAppId() reads the gate's meta; it must say word-builder. Anything else
  // (including settings-panel's Act 1 fallback on an ungated page) stops here,
  // so this page can never read or write another app's rows.
  if (!childId || getAppId() !== APP_ID) {
    grownUpPanel();
    return;
  }

  // A failed read is not the child's problem: play on with the defaults
  // (safe mode on) and an empty list where only ladder 1 is open.
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

function createGame({ childId, settings: initialSettings, completed: completedIds }) {
  const screen = document.getElementById('screen');
  const announcer = document.getElementById('announcer');
  const grownups = document.getElementById('grownups');
  document.getElementById('title').textContent = t('wordBuilder.title');

  let settings = { ...initialSettings };
  let dials = readDials();
  const completed = new Set(completedIds);
  let view = 'list';      // 'list' | 'ladder' | 'example'
  let state = null;       // engine state while a ladder is open
  let exampleAt = 0;
  let lastPostAt = Date.now();
  let message = '';

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

  // ---- progress: one POST per filled rung; never interrupts the child.
  const send = (body) => api('/api/progress', { method: 'POST', body });
  async function post(body) {
    try {
      await send(body);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 0 || status >= 500) {
        await enqueue(body).catch(() => { /* no IndexedDB: this rung is lost, the child is not */ });
      }
    }
  }
  const flushQueue = () => flushOffline(send).catch(() => { /* still offline */ });
  window.addEventListener('online', flushQueue);
  flushQueue();

  function report(done) {
    const now = Date.now();
    const seconds = Math.min(MAX_SECONDS, (now - lastPostAt) / 1000);
    lastPostAt = now;
    post(progressPayload({ childId, ladderId: state.ladder.id, step: solvedCount(state), completed: done, seconds }));
  }

  // ---- announcer: polite, emptied first so a repeat is still read.
  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  }
  // Shows `text` as the visible message, redraws, then announces and speaks
  // it, so what is on screen and what is heard never disagree.
  function say(text) {
    message = text;
    render();
    announce(text);
    speech.speak(text);
  }
  // Spoken and announced only; the visible message is left as it is.
  function speakOnly(text) {
    announce(text);
    speech.speak(text);
  }
  const clueText = () => {
    const v = state && ladderView(state, { clue: dials.clue });
    return v && v.clue ? tr(v.clue) : '';
  };

  // ---- grown-ups panel
  const panel = createPanel();
  grownups.textContent = t('wordBuilder.settings');
  grownups.hidden = false;
  grownups.setAttribute('aria-expanded', 'false');
  grownups.addEventListener('click', () => panel.toggle());
  main.append(panel.el);

  // ---- navigation
  function openList() {
    view = 'list';
    state = null;
    message = '';
    player.stop();
    render();
    screen.querySelector('.ladder-tile:not([aria-disabled])')?.focus();
  }
  function openLadder(id) {
    const ladder = ladderById(id);
    if (!ladder) return;
    view = 'ladder';
    state = initialState(ladder, { hint: dials.hint, seed: newSeed() });
    lastPostAt = Date.now();
    message = '';
    render();
    focusBank();
    speakOnly(clueText());
  }
  function openExample() {
    view = 'example';
    exampleAt = 0;
    message = '';
    render();
    screen.querySelector('h2')?.focus();
  }
  const focusBank = () => screen.querySelector('.tile')?.focus();

  // ---- dispatch with side effects
  function dispatch(action) {
    const prev = state;
    const next = reduce(state, action);
    if (next === prev) return;
    state = next;

    if (action.type === 'RESTART' || action.type === 'SELECT') {
      if (action.type === 'RESTART') { lastPostAt = Date.now(); player.stop(); }
      message = '';
      render();
      focusBank();
      speakOnly(clueText());
      return;
    }

    const fb = state.feedback;
    if (fb && fb !== prev.feedback) {
      if (fb.result === 'correct') {
        report(state.status === 'done');
        if (state.status === 'done') {
          completed.add(state.ladder.id);
          say(`${t('wordBuilder.yes', { word: fb.word })} ${t('wordBuilder.done_heading')}`);
          screen.querySelector('.celebration .action')?.focus();
          player.play('lesson');
          return;
        }
        say(`${t('wordBuilder.yes', { word: fb.word })} ${clueText()}`);
        focusBank();
        return;
      }
      if (fb.result === 'wrong-distance') {
        const cols = fb.highlight.map((i) => t('wordBuilder.check_letter', { n: i + 1 })).join(' ');
        say(`${t('wordBuilder.wrong_distance')} ${cols}`.trim());
      } else {
        say(t('wordBuilder.not_word'));
      }
      return;
    }

    // A tile went in or out: say the word so far, never the answer.
    message = '';
    render();
    const letters = placedWord(state).split('');
    announce(letters.length ? t('wordBuilder.built', { letters: letters.join(', ') }) : t('wordBuilder.built_empty'));
  }

  // ---------------------------------------------------------------- render

  // Every render rebuilds the screen, so the focused control is found again by
  // its data-focus key; if it no longer exists (a slot that was emptied), the
  // first bank tile takes focus instead of the page body.
  function render() {
    const active = document.activeElement;
    const key = active && screen.contains(active) ? active.dataset.focusKey : null;
    applyToDocument(settings);
    main.dataset.view = view;
    panel.refresh();
    if (view === 'list') renderList();
    else if (view === 'example') renderExample();
    else renderLadder();
    if (key) (screen.querySelector(`[data-focus-key="${key}"]:not([disabled])`) || screen.querySelector('.tile, h2[tabindex]'))?.focus();
  }

  function renderList() {
    const tiles = listView([...completed]).map((item) => {
      const stateText = t(`wordBuilder.state_${item.state}`);
      const locked = item.state === 'locked';
      const tile = el('button', {
        type: 'button',
        class: 'ladder-tile',
        'data-ladder': item.id,
        'data-focus-key': `ladder-${item.id}`,
        'data-state': item.state,
        'aria-label': t('wordBuilder.ladder_tile', { n: item.number, title: tr(item.title), state: stateText }),
        'aria-disabled': locked ? 'true' : null,
      },
      el('span', { class: 'tile-number' }, t('wordBuilder.ladder_number', { n: item.number })),
      el('span', { class: 'tile-title' }, tr(item.title)),
      el('span', { class: 'tile-state' },
        el('span', { class: `dot dot-${item.state}`, 'aria-hidden': 'true' },
          icon(item.state === 'done' ? 'check' : item.state === 'locked' ? 'lock' : 'ring')),
        stateText));
      tile.addEventListener('click', () => {
        if (locked) { say(t('wordBuilder.locked_note')); return; }
        openLadder(item.id);
      });
      return el('li', {}, tile);
    });

    const how = el('button', { type: 'button', class: 'action secondary', 'data-focus-key': 'how' }, t('wordBuilder.show_me_how'));
    how.addEventListener('click', openExample);

    replace(screen, el('section', { class: 'list-screen', 'aria-labelledby': 'list-heading' },
      el('h2', { id: 'list-heading' }, t('wordBuilder.list_heading')),
      el('p', { class: 'intro' }, t('wordBuilder.list_intro')),
      how,
      el('ol', { class: 'ladder-list' }, tiles),
      el('p', { class: 'feedback' }, message)));
  }

  // The column marker row: a shape over the changing column, with words.
  function columnMarker(changeIndex) {
    return el('div', { class: 'col-marker', 'aria-hidden': 'true' },
      Array.from({ length: 4 }, (_, i) => el('span', { class: i === changeIndex ? 'col is-change' : 'col' },
        i === changeIndex ? icon('down') : '')));
  }

  function rungLabel(r) {
    const n = r.index + 1;
    let s;
    if (r.state === 'given') s = t('wordBuilder.rung_given', { word: r.word });
    else if (r.state === 'solved') s = t('wordBuilder.rung_solved', { word: r.word });
    else if (r.state === 'current') s = t('wordBuilder.rung_current');
    else if (r.state === 'open') s = t('wordBuilder.rung_open');
    else s = t('wordBuilder.rung_waiting');
    if (r.hintLetter) s += `, ${t('wordBuilder.rung_starts', { letter: r.hintLetter })}`;
    return t('wordBuilder.rung_label', { n, state: s });
  }

  function rungMark(r) {
    if (r.state === 'given' || r.state === 'solved') return icon('check');
    if (r.state === 'current') return icon('arrow');
    return '';
  }

  function renderLadder() {
    const v = ladderView(state, { clue: dials.clue });
    const flagged = new Set(v.feedback && v.feedback.result === 'wrong-distance' ? v.feedback.highlight : []);

    const rungs = v.rungs.map((r) => {
      const boxes = r.letters.map((letter, i) => {
        const cls = ['box'];
        if (i === v.changeIndex) cls.push('is-change');
        if (r.state === 'current' && flagged.has(i)) cls.push('is-flag');
        if (r.state === 'current' && letter) {
          // A placed tile: tap it to take it out. Its name is the letter.
          const b = el('button', { type: 'button', class: [...cls, 'slot'].join(' '), 'aria-label': letter, 'data-focus-key': `slot-${i}` }, letter);
          b.addEventListener('click', () => dispatch({ type: 'REMOVE', slot: i }));
          return b;
        }
        const ghost = !letter && i === 0 && r.hintLetter;
        return el('span', { class: [...cls, ghost ? 'is-ghost' : '', letter ? '' : 'is-empty'].filter(Boolean).join(' '), 'aria-hidden': 'true' },
          letter || (ghost ? r.hintLetter : ''));
      });
      const label = rungLabel(r);
      const inner = [el('span', { class: 'mark', 'aria-hidden': 'true' }, rungMark(r)), el('span', { class: 'boxes' }, boxes)];
      if (r.state === 'open') {
        const b = el('button', { type: 'button', class: 'rung-btn', 'aria-label': label, 'data-focus-key': `rung-${r.index}` }, inner);
        b.addEventListener('click', () => dispatch({ type: 'SELECT', rung: r.index }));
        return el('li', { class: 'rung', 'data-state': r.state }, b);
      }
      return el('li', { class: 'rung', 'data-state': r.state, 'aria-current': r.state === 'current' ? 'step' : null },
        hidden(label), ...inner);
    });

    const back = el('button', { type: 'button', class: 'text-btn', 'data-focus-key': 'back' }, t('wordBuilder.back_to_list'));
    back.addEventListener('click', openList);

    const ladderSection = el('section', { class: 'ladder-wrap', 'aria-labelledby': 'ladder-title' },
      el('div', { class: 'ladder-head' }, back, el('h2', { id: 'ladder-title' }, tr(v.title))),
      el('p', { class: 'change-note' }, t('wordBuilder.change_column', { n: v.changeIndex + 1 })),
      columnMarker(v.changeIndex),
      el('ol', { class: 'ladder', 'aria-label': t('wordBuilder.ladder_label'), 'data-change': String(v.changeIndex) }, rungs));

    if (v.status === 'done') {
      const another = el('button', { type: 'button', class: 'action' }, t('wordBuilder.another'));
      another.addEventListener('click', openList);
      const same = el('button', { type: 'button', class: 'action secondary' }, t('wordBuilder.same_again'));
      same.addEventListener('click', () => dispatch({ type: 'RESTART', seed: newSeed() }));
      replace(screen, el('div', { class: 'play' }, ladderSection,
        el('section', { class: 'celebration', 'aria-labelledby': 'celebration-title' },
          celebrationRow(0),
          el('h2', { id: 'celebration-title' }, t('wordBuilder.done_heading')),
          el('div', { class: 'choices' }, another, same))));
      return;
    }

    const hear = el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('wordBuilder.hear_clue'), 'data-focus-key': 'hear' }, icon('speaker'));
    hear.addEventListener('click', () => { speech.unlocked = true; speech.speak(clueText()); });

    const bank = v.bank.map((tile) => {
      const b = el('button', {
        type: 'button', class: 'tile', 'data-tile': String(tile.id), 'data-focus-key': `tile-${tile.id}`, 'aria-label': tile.letter,
        'aria-pressed': tile.used ? 'true' : 'false',
      }, tile.letter);
      b.addEventListener('click', () => dispatch({ type: 'TILE', tile: tile.id }));
      return b;
    });
    const clear = el('button', { type: 'button', class: 'text-btn clear', 'data-focus-key': 'clear' }, t('wordBuilder.clear'));
    clear.addEventListener('click', () => dispatch({ type: 'CLEAR' }));

    replace(screen, el('div', { class: 'play' },
      ladderSection,
      el('section', { class: 'work', 'aria-labelledby': 'clue-heading' },
        el('h3', { id: 'clue-heading', class: 'clue-heading' }, t('wordBuilder.clue_heading')),
        el('div', { class: 'clue-row' }, el('p', { class: 'clue', id: 'clue' }, tr(v.clue)), hear),
        el('p', { class: 'feedback', 'data-result': v.feedback ? v.feedback.result : '' }, message),
        el('h3', { class: 'visually-hidden', id: 'bank-heading' }, t('wordBuilder.bank_heading')),
        el('div', { class: 'bank', role: 'group', 'aria-labelledby': 'bank-heading' }, bank),
        clear)));
  }

  function renderExample() {
    const steps = exampleSteps(EXAMPLE_LADDER);
    const step = steps[exampleAt];
    const total = steps.length;

    const rungs = steps.slice(0, exampleAt + 1).map((s) => {
      const boxes = [...s.word].map((letter, i) => {
        const changed = s.at === i;
        return el('span', { class: `box${i === EXAMPLE_LADDER.changeIndex ? ' is-change' : ''}${changed ? ' is-new' : ''}`, 'aria-hidden': 'true' },
          letter, changed ? el('span', { class: 'new-tag' }, t('wordBuilder.new_letter')) : '');
      });
      return el('li', { class: 'rung', 'data-state': s.index === exampleAt ? 'current' : 'solved' },
        hidden(s.word), el('span', { class: 'mark', 'aria-hidden': 'true' }, icon('check')), el('span', { class: 'boxes' }, boxes));
    });

    const explain = currentExplain();

    const prev = el('button', { type: 'button', class: 'action secondary', disabled: exampleAt === 0, 'data-focus-key': 'ex-prev' }, t('wordBuilder.example_prev'));
    prev.addEventListener('click', () => { exampleAt = Math.max(0, exampleAt - 1); render(); speakOnly(currentExplain()); });
    const last = exampleAt === total - 1;
    const next = el('button', { type: 'button', class: 'action', 'data-focus-key': 'ex-next' }, last ? t('wordBuilder.example_close') : t('wordBuilder.example_next'));
    next.addEventListener('click', () => {
      if (last) { openList(); return; }
      exampleAt += 1;
      render();
      speakOnly(currentExplain());
    });

    replace(screen, el('section', { class: 'example', 'aria-labelledby': 'example-title' },
      el('h2', { id: 'example-title', tabindex: '-1' }, t('wordBuilder.example_heading', { title: tr(EXAMPLE_LADDER.title) })),
      el('p', { class: 'intro' }, t('wordBuilder.example_intro')),
      el('p', { class: 'change-note' }, t('wordBuilder.change_column', { n: EXAMPLE_LADDER.changeIndex + 1 })),
      columnMarker(EXAMPLE_LADDER.changeIndex),
      el('ol', { class: 'ladder', 'aria-label': t('wordBuilder.ladder_label') }, rungs),
      el('p', { class: 'example-of' }, t('wordBuilder.example_of', { n: exampleAt + 1, total })),
      el('p', { class: 'explain' }, explain),
      el('p', { class: 'clue' }, tr(step.clue)),
      el('div', { class: 'choices' }, prev, next)));
  }

  function currentExplain() {
    const s = exampleSteps(EXAMPLE_LADDER)[exampleAt];
    return s.index === 0
      ? t('wordBuilder.example_first', { word: s.word })
      : t('wordBuilder.example_step', { from: s.from, to: s.word, n: s.at + 1, was: s.was, now: s.now });
  }

  // ---------------------------------------------------------------- grown-ups

  // For the adult. Clue and hint dials are device-only (see DIALS_KEY);
  // contrast and safe mode are this app's server settings, PUT under
  // getAppId() exactly as the Act 1 panel does. Nothing here is destructive.
  function createPanel() {
    const note = el('p', { class: 'save-note', role: 'status', 'aria-live': 'polite' });
    const tries = el('p', { class: 'tries' });

    function radios(name, values, current, labelKey, onPick) {
      return values.map((v) => {
        const id = `wb-${name}-${v}`;
        const input = el('input', { type: 'radio', name: `wb-${name}`, id, value: String(v) });
        input.checked = v === current;
        input.addEventListener('change', () => { if (input.checked) onPick(v); });
        return el('div', { class: 'check' }, input, el('label', { for: id }, t(`${labelKey}${v}`)));
      });
    }

    const clueSet = el('fieldset', {}, el('legend', {}, t('wordBuilder.clue_level')),
      radios('clue', CLUE_LEVELS, dials.clue, 'wordBuilder.clue_', (v) => {
        dials = { ...dials, clue: v };
        writeDials(dials);
        if (view === 'ladder') render();
      }));
    const hintSet = el('fieldset', {}, el('legend', {}, t('wordBuilder.hint_level')),
      radios('hint', HINT_LEVELS, dials.hint, 'wordBuilder.hint_', (v) => {
        dials = { ...dials, hint: v };
        writeDials(dials);
      }));

    function putSetting(patch) {
      settings = { ...settings, ...patch };
      applyToDocument(settings);
      note.textContent = '';
      api(`/api/children/${encodeURIComponent(childId)}/settings`, { method: 'PUT', body: { app_id: getAppId(), ...patch } })
        .then(() => { note.textContent = t('settings.saved'); })
        .catch(() => { note.textContent = t('wordBuilder.not_saved'); });
    }
    const contrastSet = el('fieldset', {}, el('legend', {}, t('settings.contrast')),
      radios('contrast', ['normal', 'high'], settings.contrast === 'high' ? 'high' : 'normal', 'settings.contrast_',
        (v) => putSetting({ contrast: v })));
    const safe = el('input', { type: 'checkbox', id: 'wb-safe' });
    safe.checked = settings.safe_mode !== false;
    safe.addEventListener('change', () => putSetting({ safe_mode: safe.checked === true }));

    const close = el('button', { type: 'button', class: 'text-btn' }, t('settings.close'));
    const aside = el('aside', { class: 'settings-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'wb-settings-title', hidden: true },
      el('h2', { id: 'wb-settings-title' }, t('wordBuilder.settings_heading')),
      clueSet,
      hintSet,
      el('p', { class: 'note' }, t('wordBuilder.dials_note')),
      tries,
      contrastSet,
      el('div', { class: 'row' },
        el('div', { class: 'check' }, safe, el('label', { for: 'wb-safe' }, t('settings.safe'))),
        el('p', { class: 'note' }, t('settings.safe_note'))),
      el('div', { class: 'row' }, languageSwitcher({ visible: true }), el('p', { class: 'note' }, t('settings.language_note'))),
      note,
      close);

    const api_ = {
      el: aside,
      refresh() {
        tries.textContent = state ? t('wordBuilder.tries', { n: state.attempts }) : '';
        tries.hidden = !state;
      },
      open() { aside.hidden = false; grownups.setAttribute('aria-expanded', 'true'); api_.refresh(); aside.querySelector('input')?.focus(); },
      close() { aside.hidden = true; grownups.setAttribute('aria-expanded', 'false'); grownups.focus(); },
      toggle() { if (aside.hidden) api_.open(); else api_.close(); },
    };
    close.addEventListener('click', () => api_.close());
    return api_;
  }

  render();
}

boot();
