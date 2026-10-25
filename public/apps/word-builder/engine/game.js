// Word Builder rules: the letter bank, the answer check, a pure reducer and
// the view descriptors the shell draws. No DOM here, so every rule runs in
// Node under test.
//
// The child builds each rung by tapping 4 tiles from an 8-tile bank, in
// order. Four tiles placed is the check - there is no submit button. A right
// word fills the rung; anything else keeps the tiles where they are and adds
// one to `attempts`, which only the grown-up panel ever shows. There is no
// timer, no score and no way to lose.
//
// Either end: a rung can be worked on when it is the top or bottom rung or
// sits next to a filled rung, so a child can climb down from the top, up from
// the bottom, or both.

import { LADDERS, RUNGS, WORD_LENGTH, CLUE_LEVELS, hamming, diffIndexes } from './ladders.js';

// Literal on purpose: progress is only ever written under this id.
export const APP_ID = 'word-builder';
export const BANK_SIZE = 8;
// ends    - the top and bottom words are filled in from the start
// letters - only the first letter of the top and bottom words is shown
// none    - nothing is given
export const HINT_LEVELS = Object.freeze(['ends', 'letters', 'none']);
export const DEFAULT_DIALS = Object.freeze({ clue: 1, hint: 'ends' });
export const MAX_SECONDS = 600; // the progress API's per-post cap

// Bank filler: plain, easily told-apart capitals. Letters already needed for
// the word are never added as filler.
const FILLER = Object.freeze('ABDEGHILMNOPRSTU'.split(''));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}

export function ladderById(id, ladders = LADDERS) {
  return ladders.find((l) => l.id === id) || null;
}

// The 8 tiles for one rung, deterministic per (ladder, rung, seed):
//   - the 4 letters of the rung's word (repeats kept: HOOK has two O tiles)
//   - up to 2 "plausible" letters: what a neighbouring rung has in the
//     changing column, so the bank can build a real word that is wrong here
//   - filler letters not in the word, to make 8
// Tiles are shuffled; each tile's id is its position in the bank.
export function buildBank(ladder, rungIndex, seed) {
  const target = ladder.rungs[rungIndex].word;
  const ci = ladder.changeIndex;
  const letters = [...target];

  const order = [rungIndex - 1, rungIndex + 1];
  for (let j = 0; j < ladder.rungs.length; j++) if (!order.includes(j)) order.push(j);
  const plausible = [];
  for (const j of order) {
    if (j < 0 || j >= ladder.rungs.length || j === rungIndex) continue;
    const l = ladder.rungs[j].word[ci];
    if (l !== target[ci] && !plausible.includes(l)) plausible.push(l);
    if (plausible.length === 2) break;
  }
  letters.push(...plausible);

  const rng = mulberry32((seed >>> 0) + rungIndex * 7919);
  const pool = FILLER.filter((l) => !letters.includes(l));
  while (letters.length < BANK_SIZE && pool.length) {
    letters.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  for (let i = letters.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [letters[i], letters[k]] = [letters[k], letters[i]];
  }
  return Object.freeze(letters.map((letter, id) => Object.freeze({ id, letter })));
}

// checkAnswer(ladder, rungIndex, word) -> { result, highlight }
//   correct         the rung's word, one letter from the rung above it
//   wrong-distance  a real word from this ladder, but it belongs on another
//                   rung: from here it is the wrong number of changes away
//                   (no change at all if it repeats a neighbour). highlight
//                   is the column(s) where it differs from what fits here.
//   not-word        not a word on this ladder; highlight is empty
// Never throws; any non-string answer is not-word.
export function checkAnswer(ladder, rungIndex, word) {
  const w = typeof word === 'string' ? word.toUpperCase() : '';
  const rungs = ladder.rungs;
  const target = rungs[rungIndex].word;
  if (w === target && (rungIndex === 0 || hamming(rungs[rungIndex - 1].word, w) === 1)) {
    return { result: 'correct', highlight: [] };
  }
  if (w.length === WORD_LENGTH && rungs.some((r) => r.word === w)) {
    return { result: 'wrong-distance', highlight: diffIndexes(w, target) };
  }
  return { result: 'not-word', highlight: [] };
}

// --------------------------------------------------------------- state

function emptySolved(hint) {
  const s = Array(RUNGS).fill(false);
  if (hint === 'ends') { s[0] = true; s[RUNGS - 1] = true; }
  return s;
}

// Unfilled rungs the child may work on now: an end, or next to a filled rung.
export function selectableRungs(solved) {
  const out = [];
  for (let i = 0; i < solved.length; i++) {
    if (solved[i]) continue;
    if (i === 0 || i === solved.length - 1 || solved[i - 1] || solved[i + 1]) out.push(i);
  }
  return out;
}

function nextCurrent(solved, from) {
  const open = selectableRungs(solved);
  if (open.length === 0) return null;
  if (open.includes(from + 1)) return from + 1;
  if (open.includes(from - 1)) return from - 1;
  return open[0];
}

function atRung(state, rung) {
  return {
    ...state,
    current: rung,
    bank: rung === null ? [] : buildBank(state.ladder, rung, state.seed),
    placed: [],
  };
}

export function initialState(ladder, { hint = DEFAULT_DIALS.hint, seed = 0 } = {}) {
  const h = HINT_LEVELS.includes(hint) ? hint : DEFAULT_DIALS.hint;
  const solved = emptySolved(h);
  const base = {
    ladder,
    seed: seed >>> 0,
    hint: h,
    given: solved.slice(),
    solved,
    current: null,
    bank: [],
    placed: [],      // tile ids, in slot order
    feedback: null,  // { result, highlight, word }
    attempts: 0,     // tries that were not right; the grown-up sees this, the child never does
    status: 'playing',
  };
  return atRung(base, selectableRungs(solved)[0]);
}

export function placedWord(state) {
  return state.placed.map((id) => state.bank[id].letter).join('');
}

function evaluate(state) {
  const word = placedWord(state);
  const res = checkAnswer(state.ladder, state.current, word);
  if (res.result !== 'correct') {
    return { ...state, attempts: state.attempts + 1, feedback: { ...res, word } };
  }
  const solved = state.solved.slice();
  solved[state.current] = true;
  const feedback = { ...res, word, rung: state.current };
  const next = nextCurrent(solved, state.current);
  if (next === null) {
    return { ...atRung({ ...state, solved }, null), status: 'done', feedback };
  }
  return { ...atRung({ ...state, solved }, next), feedback };
}

// reduce(state, action) -> next state. Unknown or impossible actions return
// the same state object, so the shell can tell nothing happened.
//   SELECT { rung }  work on another rung (must be selectable)
//   TILE   { tile }  tap a bank tile: places it, or removes it if placed
//   REMOVE { slot }  tap a filled slot: removes that tile
//   CLEAR            empty the rung being built
//   RESTART { seed } the same ladder again from the top
export function reduce(state, action) {
  if (!action || typeof action !== 'object') return state;
  if (action.type === 'RESTART') {
    return initialState(state.ladder, { hint: state.hint, seed: action.seed ?? state.seed });
  }
  if (state.status !== 'playing') return state;

  switch (action.type) {
    case 'SELECT': {
      const r = action.rung;
      if (r === state.current || !selectableRungs(state.solved).includes(r)) return state;
      return { ...atRung(state, r), feedback: null };
    }
    case 'TILE': {
      const id = action.tile;
      if (!Number.isInteger(id) || id < 0 || id >= state.bank.length) return state;
      const at = state.placed.indexOf(id);
      if (at !== -1) return { ...state, placed: state.placed.filter((x) => x !== id), feedback: null };
      if (state.placed.length >= WORD_LENGTH) return state;
      const next = { ...state, placed: [...state.placed, id], feedback: null };
      return next.placed.length === WORD_LENGTH ? evaluate(next) : next;
    }
    case 'REMOVE': {
      const s = action.slot;
      if (!Number.isInteger(s) || s < 0 || s >= state.placed.length) return state;
      return { ...state, placed: state.placed.filter((_, i) => i !== s), feedback: null };
    }
    case 'CLEAR':
      if (state.placed.length === 0) return state;
      return { ...state, placed: [], feedback: null };
    default:
      return state;
  }
}

export const solvedCount = (state) => state.solved.filter(Boolean).length;

// The POST /api/progress body. step_index is the rung the child is now on,
// counted as rungs filled (so climbing from either end still only goes up);
// completed is true once, when the last rung is filled.
export function progressPayload({ childId, ladderId, step, completed, seconds = 0 }) {
  return {
    child_id: childId,
    app_id: 'word-builder',
    lesson_id: ladderId,
    step_index: Math.max(0, Math.min(RUNGS, Math.trunc(step) || 0)),
    completed: completed === true,
    seconds: Math.max(0, Math.min(MAX_SECONDS, Math.round(Number(seconds) || 0))),
  };
}

// --------------------------------------------------------------- views

// The ladder list. Unlocking is sequential (a ladder opens when the one before
// it is done), and any done ladder can be played again.
//   -> [{ id, title, number, state: 'done' | 'open' | 'locked' }]
export function listView(completedIds = [], ladders = LADDERS) {
  const done = new Set(completedIds);
  return ladders.map((l, i) => {
    let state = 'locked';
    if (done.has(l.id)) state = 'done';
    else if (i === 0 || done.has(ladders[i - 1].id)) state = 'open';
    return { id: l.id, title: l.title, number: i + 1, state };
  });
}

// One ladder being played. A word is only in the descriptor once it is
// filled or given; the renderer is never told an unfilled answer.
//   -> { id, title, changeIndex, status, clue, rungs: [...], slots, bank, feedback }
//   rung.state: 'given' | 'solved' | 'current' | 'open' (can be chosen) | 'waiting'
export function ladderView(state, { clue = DEFAULT_DIALS.clue } = {}) {
  const level = CLUE_LEVELS.includes(Number(clue)) ? Number(clue) : DEFAULT_DIALS.clue;
  const { ladder } = state;
  const open = selectableRungs(state.solved);
  const slots = Array.from({ length: WORD_LENGTH }, (_, i) =>
    (i < state.placed.length ? state.bank[state.placed[i]].letter : ''));

  const rungs = ladder.rungs.map((r, i) => {
    const isEnd = i === 0 || i === ladder.rungs.length - 1;
    let rs = 'waiting';
    if (state.given[i]) rs = 'given';
    else if (state.solved[i]) rs = 'solved';
    else if (i === state.current) rs = 'current';
    else if (open.includes(i)) rs = 'open';
    const filled = rs === 'given' || rs === 'solved';
    return {
      index: i,
      state: rs,
      word: filled ? r.word : null,
      letters: filled ? [...r.word] : (rs === 'current' ? slots.slice() : Array(WORD_LENGTH).fill('')),
      hintLetter: !filled && state.hint === 'letters' && isEnd ? r.word[0] : null,
    };
  });

  return {
    id: ladder.id,
    title: ladder.title,
    changeIndex: ladder.changeIndex,
    status: state.status,
    clue: state.current === null ? null : ladder.rungs[state.current].clues[level],
    current: state.current,
    rungs,
    slots,
    bank: state.bank.map((t) => ({ id: t.id, letter: t.letter, used: state.placed.includes(t.id) })),
    feedback: state.feedback,
  };
}

// The "show me how" walk-through: each rung after the first, with the column
// that changed and the letters before and after.
export function exampleSteps(ladder) {
  return ladder.rungs.map((r, i) => {
    if (i === 0) return { index: 0, word: r.word, from: null, at: null, was: null, now: null, clue: r.clues[1] };
    const prev = ladder.rungs[i - 1].word;
    const at = diffIndexes(prev, r.word)[0];
    return { index: i, word: r.word, from: prev, at, was: prev[at], now: r.word[at], clue: r.clues[1] };
  });
}

export { LADDERS, RUNGS, WORD_LENGTH, CLUE_LEVELS };
