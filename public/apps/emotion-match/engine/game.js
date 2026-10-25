// Emotion Matcher rules: sessions, unlocking, a pure reducer and the view
// descriptor the shell draws. No DOM here, so every rule runs in Node.
//
// A session is 8 questions of one task type, then a celebration and a choice
// of "again" or "done". A wrong pick never costs anything: the right face is
// revealed with a neutral "this one" and the child moves on. `attempts` is
// counted for the grown-up panel only. There is no timer, no score, no streak.
//
// Unlocking: types open in order 1 -> 2 -> 3. When 4 of the child's last 5
// answers in a type are right, that type is marked complete (lesson
// `type-N`) and the next type opens. Nothing ever closes again. In "auto" a
// new type starts with the next session, so a session never changes kind
// part-way through.

import { INTENSITIES } from './faces.js';
import { ITEMS, TASK_TYPES, itemsOfType, intensityItem } from './items.js';

// Literal on purpose: progress is only ever written under this id.
export const APP_ID = 'emotion-match';
export const SESSION_LENGTH = 8;
export const UNLOCK_WINDOW = 5;
export const UNLOCK_NEEDED = 4;
export const TASK_MODES = Object.freeze(['auto', 1, 2, 3]);
export const INTENSITY_MODES = Object.freeze(['off', 'on']);
export const DEFAULT_DIALS = Object.freeze({ task: 'auto', intensity: 'off' });
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
// The chain is sequential: type-2 done without type-1 opens nothing extra.
export function unlockedFromCompleted(completedIds = []) {
  const done = new Set(completedIds);
  let open = 1;
  while (open < TASK_TYPES.length && done.has(lessonId(open))) open++;
  return open;
}

export function normaliseDials(raw) {
  const task = TASK_MODES.includes(raw?.task) ? raw.task : DEFAULT_DIALS.task;
  const intensity = INTENSITY_MODES.includes(raw?.intensity) ? raw.intensity : DEFAULT_DIALS.intensity;
  return { task, intensity };
}

// "auto" plays the highest open type; a grown-up lock plays that type.
export const sessionType = (dials, unlocked) => (dials.task === 'auto' ? unlocked : dials.task);

// --------------------------------------------------------------- sessions

// 8 distinct items of one type with their choices shuffled, deterministic per
// seed. `poolIndex` is the item's place in the shipped list for its type and
// is what progress records as step_index.
export function buildSession(type, seed, items = ITEMS) {
  const pool = itemsOfType(type, items);
  const rng = mulberry32(seed);
  return shuffle(pool.map((item, poolIndex) => ({ item, poolIndex })), rng)
    .slice(0, SESSION_LENGTH)
    .map(({ item, poolIndex }) => ({ ...item, poolIndex, choices: shuffle(item.choices, rng) }));
}

function intensityFor(base, seed, index) {
  const rng = mulberry32((seed >>> 0) ^ ((index + 1) * 2654435761));
  const target = INTENSITIES[Math.floor(rng() * INTENSITIES.length)];
  const item = intensityItem(base, target);
  return { ...item, poolIndex: base.poolIndex, choices: shuffle(item.choices, rng) };
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
    layer: 'base',
    phase: 'ask',
    picked: null,
    result: null,
    answer: null,
    startedUnlocked: state.unlocked,
  };
}

export function initialState({ dials = DEFAULT_DIALS, completed = [], seed = 1 } = {}) {
  const done = TASK_TYPES.filter((t) => completed.includes(lessonId(t)));
  return startSession({
    dials: normaliseDials(dials),
    unlocked: unlockedFromCompleted(completed),
    completedTypes: done,
    history: { 1: [], 2: [], 3: [] },
    attempts: 0,
    answered: 0,
    rightFirst: 0,
  }, seed);
}

// --------------------------------------------------------------- reducer

// Actions:
//   { type: 'PICK', id }     answer the current question
//   { type: 'NEXT' }         after a reveal: the intensity question or the next item
//   { type: 'AGAIN', seed }  a new session after the celebration
//   { type: 'DIALS', dials, seed }  the grown-up changed a dial
// Returns the same object when an action does nothing.
export function reduce(state, action) {
  if (!state || !action) return state;

  if (action.type === 'PICK') {
    if (state.phase !== 'ask') return state;
    const item = state.current;
    if (!item.choices.some((c) => c.id === action.id)) return state;
    const correct = action.id === item.correctId;
    const next = { ...state, phase: 'revealed', picked: action.id, result: correct ? 'correct' : 'shown', attempts: state.attempts + 1, answer: null };
    if (state.layer !== 'base') return next;

    // Base answers count toward unlocking; intensity answers do not.
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
      ...next,
      history,
      unlocked,
      completedTypes,
      answered: state.answered + 1,
      rightFirst: state.rightFirst + (correct ? 1 : 0),
      answer: { lessonId: lessonId(t), step: item.poolIndex, completed: completedTypes.includes(t), newlyCompleted },
    };
  }

  if (action.type === 'NEXT') {
    if (state.phase !== 'revealed') return state;
    const clear = { picked: null, result: null, answer: null, phase: 'ask' };
    if (state.layer === 'base' && state.result === 'correct' && state.dials.intensity === 'on') {
      return { ...state, ...clear, layer: 'intensity', current: intensityFor(state.current, state.seed, state.index) };
    }
    const index = state.index + 1;
    if (index >= state.queue.length) return { ...state, ...clear, phase: 'done', index };
    return { ...state, ...clear, layer: 'base', index, current: state.queue[index] };
  }

  if (action.type === 'AGAIN') {
    if (state.phase !== 'done') return state;
    return startSession(state, action.seed >>> 0);
  }

  if (action.type === 'DIALS') {
    const dials = normaliseDials(action.dials);
    if (dials.task === state.dials.task && dials.intensity === state.dials.intensity) return state;
    const changed = { ...state, dials };
    // A new task type starts a fresh session now; intensity applies from the
    // next right answer.
    return dials.task !== state.dials.task ? startSession(changed, action.seed >>> 0) : changed;
  }

  return state;
}

// --------------------------------------------------------------- progress

// One POST per base answer. lesson_id is the task type, step_index the item's
// place in that type's list. Never a score: the API's score stays null.
export function progressPayload({ childId, lessonId: lesson, step, completed, seconds = 0 }) {
  return {
    child_id: childId,
    app_id: 'emotion-match',
    lesson_id: lesson,
    step_index: Math.max(0, Math.min(1000, Math.trunc(step) || 0)),
    completed: completed === true,
    seconds: Math.max(0, Math.min(MAX_SECONDS, Math.round(Number(seconds) || 0))),
  };
}

// --------------------------------------------------------------- view

// What the shell draws. Choice `name` is the emotion (and intensity) the
// shell may say only once `revealed` is true - before that every choice is
// named by its position. Word choices (type 1) show their word, which is the
// question, not the answer.
export function itemView(state) {
  const item = state.current;
  const revealed = state.phase === 'revealed';
  const kind = state.layer === 'base' && item.type === 1 ? 'word' : 'face';
  return {
    phase: state.phase,
    layer: state.layer,
    type: state.type,
    position: Math.min(state.index + 1, state.queue.length),
    total: state.queue.length,
    prompt: item.prompt,
    audio: item.audio,
    word: item.word || null,
    amount: item.amount || null,
    face: state.layer === 'base' && item.type === 1 ? item.face : null,
    scenario: item.scenario || null,
    scene: item.scene || null,
    result: state.result,
    kind,
    choices: item.choices.map((ch, i) => ({
      n: i + 1,
      id: ch.id,
      face: ch.face,
      emotion: ch.emotion || ch.id,
      intensity: ch.intensity || null,
      kind,
      revealed,
      picked: state.picked === ch.id,
      correct: revealed && ch.id === item.correctId,
    })),
    correctId: revealed ? item.correctId : null,
    nextTimeNew: state.phase === 'done' && state.dials.task === 'auto' && state.unlocked > state.type,
  };
}
