// Money Bingo engine: pure, DOM-free, deterministic from a seed.
//
// The shell (js/main.js) dispatches actions to reduce() and draws the state
// it gets back. It never decides what happens next. Everything here runs in
// Node so test/money-bingo-engine.test.js can play whole games.
//
// The game: one child, one board, and the app as the caller. The caller shows
// and says one item; the child taps it on the board. A right tap marks the
// cell and the next item is called. A wrong tap marks nothing, calls nothing
// new, and shows a hint on the right cell - no penalty, no lost turn. There is
// no timer, no score, no losing. A completed line of 3 lights up a "Bingo!"
// button; the child taps it to declare (the app never declares for them).

import { ITEMS, ITEM_IDS } from './items.js';

// The literal app id. Progress is always written under it - never under the
// fallback in act1/js/settings-panel.js getAppId(), and never Act 1's id.
export const APP_ID = 'money-bingo';
export const LESSON_ID = 'bingo-session';

export const ROWS = 3;
export const COLS = 5;
export const CELLS = ROWS * COLS; // 15: one cell per item, no free space

// Cell index = row * COLS + col:
//
//    0  1  2  3  4
//    5  6  7  8  9
//   10 11 12 13 14
//
// A line is exactly 3 cells in a row. Not the full 5-wide row: five is too
// long a run for this age band, and a full-card win would make every game end
// the same way at the same time. On a 3x5 grid that gives:
//   - horizontal: 3-cell segments inside each 5-wide row, 3 per row  =  9
//   - vertical:   every column is exactly 3 tall                     =  5
//   - diagonal down-right (\), starting in top-row columns 0-2       =  3
//   - diagonal down-left  (/), starting in top-row columns 2-4       =  3
//                                                              total = 20
// Written out by hand so a test can assert it cell by cell.
export const LINES = Object.freeze([
  // horizontal
  [0, 1, 2], [1, 2, 3], [2, 3, 4],
  [5, 6, 7], [6, 7, 8], [7, 8, 9],
  [10, 11, 12], [11, 12, 13], [12, 13, 14],
  // vertical
  [0, 5, 10], [1, 6, 11], [2, 7, 12], [3, 8, 13], [4, 9, 14],
  // diagonal \
  [0, 6, 12], [1, 7, 13], [2, 8, 14],
  // diagonal /
  [2, 6, 10], [3, 7, 11], [4, 8, 12],
].map((l) => Object.freeze(l)));
export const LINE_COUNT = 20;

// --- seeded randomness. Never Math.random(): a board must be reproducible
// from its seed for tests and for support ("which board was it?").

// mulberry32: a small 32-bit PRNG. Returns () => float in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalise any seed to an unsigned 32-bit integer.
export function toSeed(seed) {
  const n = Number(seed);
  return Number.isFinite(n) ? (Math.trunc(n) >>> 0) : 0;
}

// A fresh seed for "new board". crypto, not Math.random(); the seed itself is
// kept in state (and on the board element) so the board can be reproduced.
export function newSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return (Date.now() >>> 0);
}

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The board: all 15 item ids, once each, in an order fixed by the seed.
export function boardFor(seed) {
  return Object.freeze(shuffled(ITEM_IDS, mulberry32(toSeed(seed))));
}

// The call deck: the 15 item ids, de-duplicated, shuffled from a stream that
// is independent of the board's (so the call order is not the board order).
// round > 0 gives the order used after a reshuffle.
const DECK_SALT = 0x9e3779b9;
export function shuffleDeck(seed, round = 0, ids = ITEM_IDS) {
  const unique = [...new Set(ids)];
  const s = (toSeed(seed) ^ DECK_SALT ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
  return Object.freeze(shuffled(unique, mulberry32(s)));
}

// Complete lines among the marked cells. `marked` is any iterable of cell
// indices. Returns the matching entries of LINES, in LINES order.
export function findLines(marked) {
  const set = new Set(marked);
  return LINES.filter((l) => l.every((i) => set.has(i)));
}

export function cellOf(state, itemId) {
  return state.board.indexOf(itemId);
}

export function currentCall(state) {
  if (state.status !== 'playing' && state.status !== 'bingo') return null;
  return state.deck[state.callIndex] ?? null;
}

// --- state

// status: 'ready'    board shown, nothing called yet (no sound on load)
//         'playing'  an item is called; waiting for a tap
//         'bingo'    a line is complete; waiting for the child to declare
//         'declared' the child tapped Bingo!; offer new board / same board
export function initialState({ seed, wins = 0, status = 'ready' } = {}) {
  const s = toSeed(seed);
  return Object.freeze({
    seed: s,
    board: boardFor(s),
    deck: shuffleDeck(s, 0),
    deckRound: 0,
    callIndex: 0,
    marked: Object.freeze([]),
    attempts: 0,  // every tap on an unmarked cell, right or wrong; never shown
    misses: 0,    // wrong taps; never shown, never held against the child
    hint: null,   // cell index to highlight after a wrong tap, else null
    lines: Object.freeze([]),
    wins,
    status,
  });
}

// Next call. If the deck has run out, reshuffle the items not yet marked and
// keep going: the child is never stranded. In solo play every call matches a
// board cell and must be marked before the next call, so a line always comes
// first and this branch is a guard; with more players (calls the child's
// board did not need) it becomes the normal path.
function advance(state) {
  const nextIndex = state.callIndex + 1;
  if (nextIndex < state.deck.length) return { ...state, callIndex: nextIndex };
  const marked = new Set(state.marked.map((i) => state.board[i]));
  const remaining = ITEM_IDS.filter((id) => !marked.has(id));
  const round = state.deckRound + 1;
  return {
    ...state,
    deck: shuffleDeck(state.seed, round, remaining.length ? remaining : ITEM_IDS),
    deckRound: round,
    callIndex: 0,
  };
}

// Pure reducer. Returns the same object when an action changes nothing.
//
// Multiplayer would attach here: the caller (deck + callIndex) would move to a
// shared session and each player's board/marked would be its own state, with
// TAP and DECLARE checked against the shared call. Out of scope: one child,
// one board, the app is the caller.
export function reduce(state, action) {
  switch (action?.type) {
    case 'START':
      if (state.status !== 'ready') return state;
      return Object.freeze({ ...state, status: 'playing' });

    case 'TAP': {
      if (state.status !== 'playing') return state;
      const cell = action.cell;
      if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return state;
      if (state.marked.includes(cell)) return state; // marked cells stay marked
      const call = currentCall(state);
      const attempts = state.attempts + 1;
      if (state.board[cell] !== call) {
        return Object.freeze({ ...state, attempts, misses: state.misses + 1, hint: cellOf(state, call) });
      }
      const marked = Object.freeze([...state.marked, cell].sort((a, b) => a - b));
      const lines = Object.freeze(findLines(marked));
      const next = { ...state, attempts, marked, lines, hint: null };
      // A line: stop and wait for the child to declare. No auto-advance.
      if (lines.length > 0) return Object.freeze({ ...next, status: 'bingo' });
      return Object.freeze(advance(next));
    }

    case 'DECLARE':
      if (state.status !== 'bingo') return state;
      return Object.freeze({ ...state, status: 'declared', wins: state.wins + 1 });

    case 'NEW_BOARD':
      if (state.status !== 'declared') return state;
      return initialState({ seed: action.seed, wins: state.wins, status: 'playing' });

    case 'SAME_BOARD':
      if (state.status !== 'declared') return state;
      return initialState({ seed: state.seed, wins: state.wins, status: 'playing' });

    default:
      return state;
  }
}

// --- progress. One POST per confirmed win (DECLARE). The server adds one to
// today's activities_completed for each POST; the field is sent as well so the
// body says what it is. app_id is the literal APP_ID, never getAppId()'s
// fallback and never act1-sensory-learning.
export const MAX_SECONDS = 600;
export function progressPayload({ childId, wins, seconds = 0 }) {
  return {
    child_id: childId,
    app_id: APP_ID,
    lesson_id: LESSON_ID,
    step_index: Math.max(0, Math.min(1000, Math.trunc(wins) || 0)),
    completed: true,
    seconds: Math.max(0, Math.min(MAX_SECONDS, Math.round(Number(seconds) || 0))),
    activities_completed: 1,
  };
}

export { ITEMS };
