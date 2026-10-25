// Pattern Puzzles rules: sessions, unlocking, a pure reducer and the view
// descriptor the shell draws. No DOM here, so every rule runs in Node.
//
// A session is 6 puzzles of one task type, then a celebration and a choice
// of "again" or "done". A wrong pick never costs anything: the right answer
// is placed in the gap and marked with a neutral "this one", the rule is
// said in plain words, and the child moves on. `attempts` is counted for the
// grown-up panel only. There is no timer, no score, no streak.
//
// The rule reveal is the point of the app: after every answer, right or
// wrong, the shell shows and speaks the puzzle's one-sentence rule. A
// grown-up can turn it off ("show rule after answer"); it is on by default.
//
// Unlocking: types open in order 1 -> 2 -> 3 -> 4. When 4 of the child's
// last 5 answers in a type are right, that type is marked complete (lesson
// `type-N`) and the next type opens. Nothing ever closes again. In "auto" a
// new type starts with the next session, so a session never changes kind
// part-way through.

import { PUZZLES, TASK_TYPES, puzzlesOfType, gridSize } from './puzzles.js';
import { normaliseCell } from './shapes.js';

// Literal on purpose: progress is only ever written under this id.
export const APP_ID = 'pattern-puzzles';
export const SESSION_LENGTH = 6;
export const UNLOCK_WINDOW = 5;
export const UNLOCK_NEEDED = 4;
export const TASK_MODES = Object.freeze(['auto', 1, 2, 3, 4]);
export const RULE_MODES = Object.freeze(['on', 'off']);
export const DEFAULT_DIALS = Object.freeze({ task: 'auto', rule: 'on' });
export const MAX_SECONDS = 600; // the progress API's per-post cap

export const lessonId = (type) => `type-${type}`;

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

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

// --------------------------------------------------------------- unlocking

// True when at least UNLOCK_NEEDED of the last UNLOCK_WINDOW answers are right.
export function shouldUnlock(results) {
  return results.slice(-UNLOCK_WINDOW).filter((r) => r === true).length >= UNLOCK_NEEDED;
}

// Highest open type from the completed lesson ids the progress API returns.
// The chain is sequential: type-3 done without type-2 opens nothing extra.
export function unlockedFromCompleted(completedIds = []) {
  const done = new Set(completedIds);
  let open = 1;
  while (open < TASK_TYPES.length && done.has(lessonId(open))) open++;
  return open;
}

export function normaliseDials(raw) {
  const task = TASK_MODES.includes(raw?.task) ? raw.task : DEFAULT_DIALS.task;
  const rule = RULE_MODES.includes(raw?.rule) ? raw.rule : DEFAULT_DIALS.rule;
  return { task, rule };
}

// "auto" plays the highest open type; a grown-up lock plays that type.
export const sessionType = (dials, unlocked) => (dials.task === 'auto' ? unlocked : dials.task);

// --------------------------------------------------------------- sessions

// 6 distinct puzzles of one type with their choices shuffled, deterministic
// per seed. `poolIndex` is the puzzle's place in the shipped list for its
// type and is what progress records as step_index.
export function buildSession(type, seed, puzzles = PUZZLES) {
  const pool = puzzlesOfType(type, puzzles);
  const rng = mulberry32(seed);
  return shuffle(pool.map((p, poolIndex) => ({ p, poolIndex })), rng)
    .slice(0, SESSION_LENGTH)
    .map(({ p, poolIndex }) => ({ ...p, poolIndex, choices: shuffle(p.choices, rng) }));
}

function startSession(state, seed) {
  const type = sessionType(state.dials, state.unlocked);
  const queue = buildSession(type, seed);
  return {
    ...state,
    seed,
    type,
    queue,
    index: 0,
    current: queue[0],
    phase: 'ask',
    picked: null,
    result: null,
    answer: null,
  };
}

export function initialState({ dials = DEFAULT_DIALS, completed = [], seed = 1 } = {}) {
  return startSession({
    dials: normaliseDials(dials),
    unlocked: unlockedFromCompleted(completed),
    completedTypes: TASK_TYPES.filter((t) => completed.includes(lessonId(t))),
    history: { 1: [], 2: [], 3: [], 4: [] },
    attempts: 0,
    answered: 0,
    rightFirst: 0,
  }, seed);
}

// --------------------------------------------------------------- reducer

// Actions:
//   { type: 'PICK', id }            answer the current puzzle
//   { type: 'NEXT' }                after the reveal: the next puzzle
//   { type: 'AGAIN', seed }         a new session after the celebration
//   { type: 'DIALS', dials, seed }  the grown-up changed a dial
// Returns the same object when an action does nothing.
export function reduce(state, action) {
  if (!state || !action) return state;

  if (action.type === 'PICK') {
    if (state.phase !== 'ask') return state;
    const p = state.current;
    if (!p.choices.some((c) => c.id === action.id)) return state;
    const correct = action.id === p.correctId;
    const t = state.type;
    const history = { ...state.history, [t]: [...state.history[t], correct] };
    let { unlocked, completedTypes } = state;
    let newlyCompleted = false;
    if (!completedTypes.includes(t) && shouldUnlock(history[t])) {
      completedTypes = [...completedTypes, t];
      newlyCompleted = true;
      // The chain stays sequential even when a grown-up locked a later type.
      unlocked = Math.max(unlocked, unlockedFromCompleted(completedTypes.map(lessonId)));
    }
    return {
      ...state,
      phase: 'revealed',
      picked: action.id,
      result: correct ? 'correct' : 'shown',
      attempts: state.attempts + 1,
      answered: state.answered + 1,
      rightFirst: state.rightFirst + (correct ? 1 : 0),
      history,
      unlocked,
      completedTypes,
      answer: { lessonId: lessonId(t), step: p.poolIndex, completed: completedTypes.includes(t), newlyCompleted },
    };
  }

  if (action.type === 'NEXT') {
    if (state.phase !== 'revealed') return state;
    const clear = { picked: null, result: null, answer: null, phase: 'ask' };
    const index = state.index + 1;
    if (index >= state.queue.length) return { ...state, ...clear, phase: 'done', index };
    return { ...state, ...clear, index, current: state.queue[index] };
  }

  if (action.type === 'AGAIN') {
    if (state.phase !== 'done') return state;
    return startSession(state, action.seed >>> 0);
  }

  if (action.type === 'DIALS') {
    const dials = normaliseDials(action.dials);
    if (dials.task === state.dials.task && dials.rule === state.dials.rule) return state;
    const changed = { ...state, dials };
    // A new task type starts a fresh session now; the rule dial applies from
    // the next answer.
    return dials.task !== state.dials.task ? startSession(changed, action.seed >>> 0) : changed;
  }

  return state;
}

// --------------------------------------------------------------- progress

// One POST per answer. lesson_id is the task type, step_index the puzzle's
// place in that type's list. Never a score: the API's score stays null.
export function progressPayload({ childId, lessonId: lesson, step, completed, seconds = 0 }) {
  return {
    child_id: childId,
    app_id: 'pattern-puzzles',
    lesson_id: lesson,
    step_index: Math.max(0, Math.min(1000, Math.trunc(step) || 0)),
    completed: completed === true,
    seconds: Math.max(0, Math.min(MAX_SECONDS, Math.round(Number(seconds) || 0))),
  };
}

// --------------------------------------------------------------- view

const look = (x, count) => ({ ...normaliseCell(x), count: count ?? null });

// What the shell draws: the grid (rows x cols, reading order), the three
// choices, and once revealed, the answer in the gap and the rule keys.
export function itemView(state) {
  const p = state.current;
  const revealed = state.phase === 'revealed';
  const right = p.choices.find((c) => c.id === p.correctId);
  const cols = gridSize(p);
  const rows = p.cells.length / cols;
  const cells = p.cells.map((x, i) => {
    const missing = x === null;
    const shownCount = p.type === 4 ? (missing ? right.count : p.counts[i]) : null;
    return {
      index: i,
      row: Math.floor(i / cols),
      col: i % cols,
      missing,
      // The gap stays empty until the reveal, then shows the answer.
      look: missing ? (revealed ? look(right, shownCount) : null) : look(x, shownCount),
      answer: missing && revealed,
    };
  });
  return {
    phase: state.phase,
    type: state.type,
    puzzleId: p.id,
    position: Math.min(state.index + 1, state.queue.length),
    total: state.queue.length,
    prompt: `patternPuzzles.prompt_t${p.type}`,
    audio: `patternPuzzles.audio_t${p.type}`,
    rows,
    cols,
    cells,
    result: state.result,
    choices: p.choices.map((ch, i) => ({
      n: i + 1,
      id: ch.id,
      look: look(ch, ch.count),
      revealed,
      picked: state.picked === ch.id,
      correct: revealed && ch.id === p.correctId,
    })),
    correctId: revealed ? p.correctId : null,
    showRule: revealed && state.dials.rule === 'on',
    rule: { key: `patternPuzzles.rule.${p.id}`, text: p.rule },
    axisRules: p.type === 3
      ? [{ key: `patternPuzzles.row_rule.${p.id}`, text: p.rowRule }, { key: `patternPuzzles.col_rule.${p.id}`, text: p.colRule }]
      : [],
    nextTimeNew: state.phase === 'done' && state.dials.task === 'auto' && state.unlocked > state.type,
  };
}
