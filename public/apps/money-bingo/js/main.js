// Money Bingo shell: the only module that touches the DOM for the game.
//
// It dispatches actions to engine/bingo.js and draws the state it gets back.
// It never decides what happens next, never trusts a child id from anywhere
// but the gate's <meta name="child-id">, and never writes progress under any
// app id but the engine's literal APP_ID.
//
// One action per screen: Start, then tap the board, then Bingo!, then pick a
// board. The board is the same markup the gate served (index.html); this file
// fills it in place. Nothing moves unless the child moves it, and nothing is
// spoken until the child's first tap.
//
// Reused from the family: settings resolution, applyToDocument and getAppId
// (act1/js/settings-panel.js), the safe-mode reward player, the guide's
// celebration row (act1/js/companion.js), the offline progress queue, and
// /js/i18n.js for every visible and spoken string.

import { api, ApiError } from '/js/api.js';
import { el, replace } from '/js/ui.js';
import { initI18n, t, speechLang } from '/js/i18n.js';
import { DEFAULT_SETTINGS, resolveInitial, applyToDocument, getAppId } from '/apps/act1/js/settings-panel.js';
import { createRewardPlayer } from '/apps/act1/js/reward-player.js';
import { celebrationRow } from '/apps/act1/js/companion.js';
import { enqueue, flush as flushOffline } from '/apps/act1/js/offline-queue.js';
import {
  APP_ID, ROWS, COLS, ITEMS,
  initialState, reduce, currentCall, newSeed, progressPayload,
} from '../engine/bingo.js';
import { moneySvgFor } from '../engine/money-svg.js';

const main = document.getElementById('app');
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const itemsById = new Map(ITEMS.map((i) => [i.id, i]));

// The translated name of an item, falling back to the engine's English label.
function itemLabel(id) {
  const key = `moneyBingo.items.${id}`;
  const text = t(key);
  return text === key ? (itemsById.get(id)?.audio ?? id) : text;
}

// ---------------------------------------------------------------- svg

// Money SVG markup -> DOM node without innerHTML. The library is frozen,
// self-authored and validated at load; a DOMParser document is inert.
const parser = new DOMParser();
const svgCache = new Map();
function svgNode(key) {
  const markup = moneySvgFor(key);
  if (!markup) return null;
  let tpl = svgCache.get(key);
  if (!tpl) {
    const root = parser.parseFromString(markup, 'text/html').body.querySelector('svg');
    if (!root) return null;
    tpl = document.importNode(root, true);
    svgCache.set(key, tpl);
  }
  return tpl.cloneNode(true);
}

// Chrome icons, drawn here so a money picture never doubles as a control.
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(ns, 'path');
  if (name === 'check') {
    p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '3.5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else {
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7.3v2.1a5.5 5.5 0 0 1 0 10.4v2.1a7.5 7.5 0 0 0 0-14.6z');
  }
  svg.append(p);
  return svg;
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
      u.lang = speechLang(); // spoken audio follows the UI language
      u.rate = 0.9;
      u.volume = this.volume;
      speechSynthesis.speak(u);
    } catch { /* no voices available */ }
  },
};

// ---------------------------------------------------------------- boot

function grownUpPanel() {
  applyToDocument(DEFAULT_SETTINGS);
  replace(main, el('section', { class: 'panel' },
    el('h1', {}, t('moneyBingo.grownup_heading')),
    el('p', {}, t('moneyBingo.grownup_body')),
    el('a', { class: 'action', href: '/parent' }, t('moneyBingo.back_to_my_apps'))));
}

async function boot() {
  await initI18n().catch(() => { /* English is the fallback */ });
  document.title = t('moneyBingo.title');
  const meta = document.querySelector('meta[name="child-id"]');
  const childId = meta ? meta.content.trim() : '';
  // getAppId() reads the gate's meta; it must say money-bingo. Anything else
  // (including settings-panel's Act 1 fallback on an ungated page) stops here,
  // so this page can never read or write another app's rows.
  if (!childId || getAppId() !== APP_ID) {
    grownUpPanel();
    return;
  }

  // Settings are per app. A failed read is not the child's problem: play on
  // with the defaults, which have safe mode on.
  let settings = { ...DEFAULT_SETTINGS };
  try {
    const row = await api(`/api/children/${encodeURIComponent(childId)}/settings?app_id=${APP_ID}`);
    settings = resolveInitial(row, null, row.is_default ? null : row.updated_at || null);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
  }
  applyToDocument(settings);
  createGame({ childId, settings });
}

// ---------------------------------------------------------------- game

function createGame({ childId, settings }) {
  const board = document.getElementById('board');
  const cells = [...board.querySelectorAll('button.cell')];
  const callCard = document.getElementById('call-card');
  const feedback = document.getElementById('feedback');
  const actions = document.getElementById('actions');
  const announcer = document.getElementById('announcer');

  document.getElementById('title').textContent = t('moneyBingo.title');
  document.getElementById('caller-heading').textContent = t('moneyBingo.caller_heading');
  document.getElementById('board-label').textContent = t('moneyBingo.board_label');

  let state = initialState({ seed: newSeed() });
  let boardShownAt = Date.now();
  let message = t('moneyBingo.start_hint');

  speech.volume = Math.max(0, Math.min(1, Number(settings.volume ?? 60) / 100));
  const player = createRewardPlayer({ root: document.body, settings, prefersReducedMotion });

  // First real gesture unlocks audio and speech. Nothing plays before it.
  function unlockOnce() {
    player.unlockAudio();
    speech.unlocked = true;
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  }
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);

  // ---- progress: one POST per declared win; never interrupts the child.
  const send = (body) => api('/api/progress', { method: 'POST', body });
  async function post(body) {
    try {
      await send(body);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 0 || status >= 500) {
        await enqueue(body).catch(() => { /* no IndexedDB: this win is lost, the child is not */ });
      }
    }
  }
  const flushQueue = () => flushOffline(send).catch(() => { /* still offline */ });
  window.addEventListener('online', flushQueue);
  flushQueue();

  // ---- announcer: polite, emptied first so a repeat is still read.
  function announce(text) {
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = text; });
  }
  function say(text) {
    message = text;
    feedback.textContent = text;
    announce(text);
    speech.speak(text);
  }

  // ---- input
  cells.forEach((btn, i) => {
    btn.addEventListener('click', () => dispatch({ type: 'TAP', cell: i }));
    btn.addEventListener('keydown', (e) => moveFocus(e, i));
  });

  // Arrow keys move around the grid; Tab still walks it in reading order.
  function moveFocus(e, i) {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    let target = null;
    if (e.key === 'ArrowRight' && c < COLS - 1) target = i + 1;
    else if (e.key === 'ArrowLeft' && c > 0) target = i - 1;
    else if (e.key === 'ArrowDown' && r < ROWS - 1) target = i + COLS;
    else if (e.key === 'ArrowUp' && r > 0) target = i - COLS;
    else if (e.key === 'Home') target = r * COLS;
    else if (e.key === 'End') target = r * COLS + COLS - 1;
    if (target === null) return;
    e.preventDefault();
    cells[target].focus();
  }

  function findText(id) {
    return t('moneyBingo.find', { item: itemLabel(id) });
  }

  // ---- dispatch with side effects
  function dispatch(action) {
    const prev = state;
    const next = reduce(state, action);
    if (next === prev) return;
    state = next;

    switch (action.type) {
      case 'START':
      case 'NEW_BOARD':
      case 'SAME_BOARD':
        boardShownAt = Date.now();
        player.stop();
        render();
        say(findText(currentCall(state)));
        cells[0].focus();
        return;
      case 'TAP':
        render();
        if (state.status === 'bingo') {
          say(t('moneyBingo.line_ready'));
          actions.querySelector('button')?.focus();
        } else if (state.hint !== null) {
          say(t('moneyBingo.hint', { item: itemLabel(currentCall(state)) }));
        } else {
          const again = state.deckRound !== prev.deckRound ? `${t('moneyBingo.reshuffled')} ` : '';
          say(`${t('moneyBingo.yes', { item: itemLabel(prev.board[action.cell]) })} ${again}${findText(currentCall(state))}`);
        }
        return;
      case 'DECLARE':
        render();
        post(progressPayload({ childId, wins: state.wins, seconds: (Date.now() - boardShownAt) / 1000 }));
        say(t('moneyBingo.bingo_done'));
        actions.querySelector('button')?.focus();
        player.play('lesson');
        return;
      default:
        render();
    }
  }

  // ---------------------------------------------------------------- render

  function render() {
    applyToDocument(settings);
    board.dataset.seed = String(state.seed); // for support: the board can be rebuilt from it
    board.dataset.status = state.status;
    const lineCells = new Set(state.lines.flat());
    const locked = state.status !== 'playing';

    cells.forEach((btn, i) => {
      const id = state.board[i];
      const marked = state.marked.includes(i);
      const name = itemLabel(id);
      btn.replaceChildren(
        svgNode(itemsById.get(id).svg) || '',
        el('span', { class: 'cell-label' }, name),
        marked ? el('span', { class: 'mark', 'aria-hidden': 'true' }, icon('check')) : '',
      );
      btn.dataset.item = id;
      btn.setAttribute('aria-pressed', marked ? 'true' : 'false');
      btn.setAttribute('aria-label', t('moneyBingo.cell_label', {
        item: name, state: marked ? t('moneyBingo.marked') : t('moneyBingo.not_marked'),
      }));
      // Before Start the board is inert; after that, cells stay focusable and
      // a marked (or finished) cell says so instead of disappearing from Tab.
      btn.disabled = state.status === 'ready';
      if (marked || locked) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
      btn.classList.toggle('is-marked', marked);
      btn.classList.toggle('is-hint', state.hint === i);
      btn.classList.toggle('is-line', lineCells.has(i));
    });

    renderCaller();
    renderActions();
  }

  function renderCaller() {
    const call = currentCall(state);
    if (!call) {
      replace(callCard);
      feedback.textContent = message;
      return;
    }
    const replay = el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('moneyBingo.hear_again') }, icon('speaker'));
    replay.addEventListener('click', () => { speech.unlocked = true; speech.speak(findText(call)); });
    replace(callCard,
      el('div', { class: 'call-picture' }, svgNode(itemsById.get(call).svg)),
      el('p', { class: 'call-label' }, el('span', { class: 'call-prefix' }, t('moneyBingo.caller_says')), ' ', itemLabel(call)),
      replay);
    feedback.textContent = message;
  }

  function renderActions() {
    if (state.status === 'ready') {
      const start = el('button', { type: 'button', class: 'action' }, t('moneyBingo.start'));
      start.addEventListener('click', () => dispatch({ type: 'START' }));
      replace(actions, start);
      return;
    }
    if (state.status === 'bingo') {
      // The declaration step: the child says Bingo, the app does not.
      const bingo = el('button', { type: 'button', class: 'action bingo' }, t('moneyBingo.bingo_button'));
      bingo.addEventListener('click', () => dispatch({ type: 'DECLARE' }));
      replace(actions, bingo);
      return;
    }
    if (state.status === 'declared') {
      const fresh = el('button', { type: 'button', class: 'action' }, t('moneyBingo.new_board'));
      fresh.addEventListener('click', () => dispatch({ type: 'NEW_BOARD', seed: newSeed() }));
      const same = el('button', { type: 'button', class: 'action secondary' }, t('moneyBingo.same_board'));
      same.addEventListener('click', () => dispatch({ type: 'SAME_BOARD' }));
      replace(actions, el('section', { class: 'celebration', 'aria-labelledby': 'celebration-title' },
        celebrationRow(0),
        el('h2', { id: 'celebration-title' }, t('moneyBingo.bingo_done')),
        el('p', {}, t('moneyBingo.play_again')),
        el('div', { class: 'choices' }, fresh, same)));
      return;
    }
    replace(actions); // playing: the board is the one action
  }

  render();
}

boot();
