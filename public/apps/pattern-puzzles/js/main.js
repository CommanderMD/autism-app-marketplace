// Pattern Puzzles shell: the only module that touches the DOM for the game.
//
// It dispatches actions to engine/game.js and draws the itemView descriptor
// it gets back. It never decides whether an answer is right, never trusts a
// child id from anywhere but the gate's <meta name="child-id">, and never
// writes progress under any app id but the engine's literal 'pattern-puzzles'.
//
// One puzzle at a time: the prompt (with a replay button), the puzzle grid
// with its one empty cell, then three choices. After any answer the right
// one fills the gap, is marked with a neutral "this one" when the pick was
// wrong, and the rule is shown and spoken in one sentence. The child moves
// on with "Next" when ready. No timer, no score, no streak. Nothing is
// spoken until the child's first tap.
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
  APP_ID, TASK_MODES, RULE_MODES, MAX_SECONDS,
  initialState, reduce, newSeed, normaliseDials, progressPayload, itemView,
} from '../engine/game.js';
import { SHAPES, shapeSvg, countSvg } from '../engine/shapes.js';

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Task type and the rule dial are the grown-up's dials. The settings API has
// no columns for them, so they live on this device, like the other games.
const DIALS_KEY = 'pattern-puzzles.dials.v1';
function readDials() {
  try {
    return normaliseDials(JSON.parse(localStorage.getItem(DIALS_KEY) || 'null'));
  } catch {
    return normaliseDials(null);
  }
}
function writeDials(d) {
  try { localStorage.setItem(DIALS_KEY, JSON.stringify({ task: d.task, rule: d.rule })); } catch { /* this page only */ }
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

// The shape library is frozen and self-authored (no scripts, no hrefs), and
// a DOMParser document is inert, so parsing it runs nothing.
const parser = new DOMParser();
function svgNode(markup) {
  if (!markup) return null;
  const root = parser.parseFromString(markup, 'text/html').body.querySelector('svg');
  return root ? document.importNode(root, true) : null;
}

// Fill patterns need ids that are unique in the page.
let uidCounter = 0;
const picture = (look) => svgNode(look.count ? countSvg(look, look.count, ++uidCounter) : shapeSvg(look, ++uidCounter));

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

// ---------------------------------------------------------------- words

// Which way a pointed shape points when unturned; each quarter turn is one
// step clockwise.
const DIRS = ['up', 'right', 'down', 'left'];
const BASE_DIR = { triangle: 0, arrow: 1 };

// Everything a cell shows, in words: shape, fill (colour and pattern), size,
// and for pointed shapes the way they point. Counting cells say how many.
function lookLabel(look) {
  if (look.count) {
    return look.count === 1
      ? t('patternPuzzles.count_one', { shape: t(`patternPuzzles.shape.${look.shape}`) })
      : t('patternPuzzles.count_many', { n: look.count, shapes: t(`patternPuzzles.shapes.${look.shape}`) });
  }
  const base = t(look.size === 'small' ? 'patternPuzzles.look_small' : 'patternPuzzles.look_big', {
    fill: t(`patternPuzzles.fill.${look.fill}`),
    shape: t(`patternPuzzles.shape.${look.shape}`),
  });
  if (!SHAPES[look.shape].turns) return base;
  const dir = DIRS[(BASE_DIR[look.shape] + look.turn / 90) % 4];
  return t('patternPuzzles.look_turned', { look: base, dir: t(`patternPuzzles.dir.${dir}`) });
}

// Rule sentences live in i18n under the puzzle id; the English in the
// puzzle data is the fallback if a key were ever missing.
function said(entry) {
  const s = t(entry.key);
  return s === entry.key ? entry.text : s;
}

// ---------------------------------------------------------------- boot

function grownUpPanel() {
  applyToDocument(DEFAULT_SETTINGS);
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, t('patternPuzzles.grownup_heading')),
    el('p', {}, t('patternPuzzles.grownup_body')),
    el('a', { class: 'action', href: '/parent' }, t('patternPuzzles.back_to_my_apps'))));
}

async function boot() {
  await initI18n().catch(() => { /* English is the fallback */ });
  document.title = t('patternPuzzles.title');
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  // getAppId() reads the gate's meta; it must say pattern-puzzles. Anything
  // else (including settings-panel's Act 1 fallback on an ungated page) stops
  // here, so this page can never read or write another app's rows.
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
  document.getElementById('title').textContent = t('patternPuzzles.title');

  let settings = { ...initialSettings };
  let state = initialState({ dials: readDials(), completed, seed: newSeed() });
  let lastPostAt = Date.now();
  let message = '';
  let finished = false; // "Done" pressed: the goodbye screen
  let focusCell = 0;    // the grid's one tab stop (roving tabindex)

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

  // ---- progress: one POST per answer; never interrupts the child.
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

  // The rule, and for a matrix the two axis rules, once an answer is in.
  const ruleLines = (v) => (v.showRule ? [said(v.rule), ...v.axisRules.map(said)] : []);

  // ---- grown-ups panel
  const panel = createPanel();
  grownups.textContent = t('patternPuzzles.settings');
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
      message = state.result === 'correct' ? t('patternPuzzles.yes') : t('patternPuzzles.this_one');
      // The teaching moment: the result, then the rule in one sentence.
      const spoken = [message, ...(v.showRule ? [said(v.rule)] : [])].join(' ');
      render();
      screen.querySelector('.next')?.focus();
      announce([message, ...ruleLines(v)].join(' '));
      speech.speak(spoken);
      return;
    }

    // The rule dial keeps the current puzzle: redraw, say nothing.
    if (action.type === 'DIALS' && state.queue === prev.queue) { render(); return; }

    message = '';
    focusCell = 0;
    if (state.phase === 'done') {
      render();
      screen.querySelector('.celebration .action')?.focus();
      announce(`${t('patternPuzzles.done_heading')} ${t('patternPuzzles.done_body', { total: v.total })}`);
      speech.speak(t('patternPuzzles.done_heading'));
      player.play('lesson');
      return;
    }
    // A new puzzle: draw it, then say it. The child asked for it (Next,
    // Again, or a dial), so speaking now is not autoplay.
    if (action.type === 'AGAIN' || action.type === 'DIALS') { player.stop(); lastPostAt = Date.now(); }
    render();
    screen.querySelector('.cell[tabindex="0"]')?.focus();
    announce(t(v.prompt));
    speech.speak(t(v.audio));
  }

  // ---------------------------------------------------------------- render

  function render() {
    applyToDocument(settings);
    panel.refresh();
    if (finished) { renderBye(); return; }
    const v = itemView(state);
    main.dataset.view = v.phase === 'done' ? 'done' : 'puzzle';
    if (v.phase === 'done') renderDone(v);
    else renderPuzzle(v);
  }

  // role="grid": rows of gridcells in reading order. One cell is in the tab
  // order; the arrow keys, Home and End move between cells, so the whole
  // puzzle can be read cell by cell from the keyboard. The gap is announced
  // as "Empty, needs an answer" until the reveal names the answer.
  function puzzleGrid(v) {
    const cells = v.cells.map((c) => {
      const label = c.missing && !c.answer
        ? t('patternPuzzles.missing')
        : c.answer ? t('patternPuzzles.answer_cell', { look: lookLabel(c.look) }) : lookLabel(c.look);
      return el('div', {
        role: 'gridcell',
        class: `cell${c.missing ? ' is-gap' : ''}${c.answer ? ' is-answer' : ''}`,
        tabindex: c.index === focusCell ? '0' : '-1',
        'data-index': String(c.index),
        'aria-label': label,
      },
      c.answer ? el('span', { class: 'answer-mark', 'aria-hidden': 'true' }, icon('check')) : null,
      c.look ? picture(c.look) : el('span', { class: 'gap-mark', 'aria-hidden': 'true' }, '?'));
    });
    const rows = [];
    for (let r = 0; r < v.rows; r++) {
      rows.push(el('div', { role: 'row', class: 'grid-row' }, cells.slice(r * v.cols, (r + 1) * v.cols)));
    }
    const grid = el('div', {
      role: 'grid',
      class: `puzzle-grid grid-${v.rows}x${v.cols} type-${v.type}`,
      'aria-label': t('patternPuzzles.grid_label'),
      'aria-describedby': 'prompt',
      'aria-readonly': 'true',
    }, rows);

    grid.addEventListener('keydown', (e) => {
      const from = Number(e.target?.dataset?.index);
      if (!Number.isInteger(from)) return;
      const r = Math.floor(from / v.cols);
      let to = from;
      if (e.key === 'ArrowRight') to = Math.min(from + 1, v.cells.length - 1);
      else if (e.key === 'ArrowLeft') to = Math.max(from - 1, 0);
      else if (e.key === 'ArrowDown') to = r + 1 < v.rows ? from + v.cols : from;
      else if (e.key === 'ArrowUp') to = r > 0 ? from - v.cols : from;
      else if (e.key === 'Home') to = e.ctrlKey ? 0 : r * v.cols;
      else if (e.key === 'End') to = e.ctrlKey ? v.cells.length - 1 : r * v.cols + v.cols - 1;
      else return;
      e.preventDefault();
      if (to === from) return;
      cells[focusCell]?.setAttribute('tabindex', '-1');
      focusCell = to;
      cells[to].setAttribute('tabindex', '0');
      cells[to].focus();
    });
    return grid;
  }

  function renderPuzzle(v) {
    const hear = el('button', { type: 'button', class: 'icon-btn hear', 'aria-label': t('patternPuzzles.hear_again') }, icon('speaker'));
    hear.addEventListener('click', () => { speech.unlocked = true; speech.speak(t(v.audio)); });

    // Choices are named by position and by what they show. Naming a shape
    // does not give the answer away: the pattern is the question.
    const choices = v.choices.map((c) => {
      const b = el('button', {
        type: 'button',
        class: `choice${c.correct ? ' is-answer' : ''}`,
        'data-choice': c.id,
        'aria-label': t('patternPuzzles.choice_n', { n: c.n, look: lookLabel(c.look) }),
        'aria-pressed': c.picked ? 'true' : 'false',
        'aria-disabled': c.revealed ? 'true' : null,
      }, c.correct ? el('span', { class: 'answer-mark', 'aria-hidden': 'true' }, icon('check')) : null, picture(c.look));
      b.addEventListener('click', () => { if (!c.revealed) dispatch({ type: 'PICK', id: c.id }); });
      return b;
    });

    const parts = [
      el('p', { class: 'position' }, t('patternPuzzles.position', { n: v.position, total: v.total })),
      el('div', { class: 'prompt-line' }, el('h2', { id: 'prompt' }, t(v.prompt)), hear),
      puzzleGrid(v),
      el('div', { class: 'choice-row', role: 'group', 'aria-label': t('patternPuzzles.choices_label') }, choices),
      el('p', { class: 'feedback', 'data-result': v.result || '' }, message),
    ];
    if (v.phase === 'revealed') {
      const [rule, ...axes] = ruleLines(v);
      if (rule) {
        parts.push(el('div', { class: 'rule' },
          el('p', { class: 'rule-text' }, rule),
          ...axes.map((line) => el('p', { class: 'rule-axis' }, line))));
      }
      const next = el('button', { type: 'button', class: 'action next' }, t('patternPuzzles.next'));
      next.addEventListener('click', () => dispatch({ type: 'NEXT' }));
      parts.push(next);
    }
    replace(screen, el('section', { class: `puzzle type-${v.type}`, 'data-puzzle': v.puzzleId, 'aria-labelledby': 'prompt' }, parts));
  }

  function renderDone(v) {
    const again = el('button', { type: 'button', class: 'action' }, t('patternPuzzles.again'));
    again.addEventListener('click', () => dispatch({ type: 'AGAIN', seed: newSeed() }));
    const done = el('button', { type: 'button', class: 'action secondary' }, t('patternPuzzles.done'));
    done.addEventListener('click', () => {
      finished = true;
      player.stop();
      render();
      screen.querySelector('.action')?.focus();
      announce(t('patternPuzzles.bye'));
    });
    replace(screen, el('section', { class: 'celebration', 'aria-labelledby': 'celebration-title' },
      celebrationRow(0),
      el('h2', { id: 'celebration-title' }, t('patternPuzzles.done_heading')),
      el('p', {}, t('patternPuzzles.done_body', { total: v.total })),
      v.nextTimeNew ? el('p', { class: 'note' }, t('patternPuzzles.next_time_new')) : null,
      el('div', { class: 'choices' }, again, done)));
  }

  function renderBye() {
    main.dataset.view = 'bye';
    const again = el('button', { type: 'button', class: 'action' }, t('patternPuzzles.again'));
    again.addEventListener('click', () => { finished = false; dispatch({ type: 'AGAIN', seed: newSeed() }); });
    replace(screen, el('section', { class: 'celebration' }, el('h2', {}, t('patternPuzzles.bye')), again));
  }

  // ---------------------------------------------------------------- grown-ups

  // For the adult. Task type and the rule dial are device-only (see
  // DIALS_KEY); contrast and safe mode are this app's server settings, PUT
  // under getAppId() exactly as the Act 1 panel does. Picks are shown here
  // and nowhere else.
  function createPanel() {
    const note = el('p', { class: 'save-note', role: 'status', 'aria-live': 'polite' });
    const tries = el('p', { class: 'tries' });
    const open = el('p', { class: 'note' });

    function radios(name, values, current, labelKey, onPick) {
      return values.map((v) => {
        const id = `pp-${name}-${v}`;
        const input = el('input', { type: 'radio', name: `pp-${name}`, id, value: String(v) });
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

    const taskSet = el('fieldset', {}, el('legend', {}, t('patternPuzzles.task_level')),
      radios('task', TASK_MODES, state.dials.task, 'patternPuzzles.task_', (v) => setDials({ task: v })));
    const ruleSet = el('fieldset', {}, el('legend', {}, t('patternPuzzles.rule_level')),
      radios('rule', RULE_MODES, state.dials.rule, 'patternPuzzles.rule_', (v) => setDials({ rule: v })));

    function putSetting(patch) {
      settings = { ...settings, ...patch };
      applyToDocument(settings);
      note.textContent = '';
      api(`/api/children/${encodeURIComponent(childId)}/settings`, { method: 'PUT', body: { app_id: getAppId(), ...patch } })
        .then(() => { note.textContent = t('settings.saved'); })
        .catch(() => { note.textContent = t('patternPuzzles.not_saved'); });
    }
    const contrastSet = el('fieldset', {}, el('legend', {}, t('settings.contrast')),
      radios('contrast', ['normal', 'high'], settings.contrast === 'high' ? 'high' : 'normal', 'settings.contrast_',
        (v) => putSetting({ contrast: v })));
    const safe = el('input', { type: 'checkbox', id: 'pp-safe' });
    safe.checked = settings.safe_mode !== false;
    safe.addEventListener('change', () => putSetting({ safe_mode: safe.checked === true }));

    const close = el('button', { type: 'button', class: 'text-btn' }, t('settings.close'));
    const aside = el('aside', { class: 'settings-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pp-settings-title', hidden: true },
      el('h2', { id: 'pp-settings-title' }, t('patternPuzzles.settings_heading')),
      taskSet,
      ruleSet,
      el('p', { class: 'note' }, t('patternPuzzles.dials_note')),
      tries,
      open,
      contrastSet,
      el('div', { class: 'row' },
        el('div', { class: 'check' }, safe, el('label', { for: 'pp-safe' }, t('settings.safe'))),
        el('p', { class: 'note' }, t('settings.safe_note'))),
      el('div', { class: 'row' }, languageSwitcher({ visible: true }), el('p', { class: 'note' }, t('settings.language_note'))),
      note,
      close);

    const api_ = {
      el: aside,
      refresh() {
        tries.textContent = t('patternPuzzles.tries', { n: state.attempts, right: state.rightFirst, answered: state.answered });
        open.textContent = t('patternPuzzles.open_types', { n: state.unlocked });
      },
      open() { aside.hidden = false; grownups.setAttribute('aria-expanded', 'true'); api_.refresh(); aside.querySelector('input')?.focus(); },
      close() { aside.hidden = true; grownups.setAttribute('aria-expanded', 'false'); grownups.focus(); },
      toggle() { if (aside.hidden) api_.open(); else api_.close(); },
    };
    close.addEventListener('click', () => api_.close());
    return api_;
  }

  // First draw: the first puzzle, silent until the child taps.
  render();
  announce(t(itemView(state).prompt));
}

boot();
