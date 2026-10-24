// Act 1 lesson contract and validator.
//
// Every lesson module under ../lessons/ default-exports:
//
//   {
//     id: '01-shapes',     // file name without .js; two-digit prefix === order
//     title: 'Basic Shapes',
//     order: 1,            // integer 1-10; the curriculum order is derived from it
//     steps: [ ...>= 8 steps ],
//     render(step, ctx),   // -> view descriptor (below)
//     check(answer, step), // -> { correct, highlight }
//   }
//
// STEP SHAPE
//
//   {
//     id: 'shapes-01',          // unique within the lesson
//     prompt: 'Tap the circle.',// short, literal, present tense; one action
//     audio: 'Tap the circle.', // the spoken prompt: plain words, no symbols
//     mode: 'tap',              // 'tap' | 'drag' | 'sequence'
//     choices: [                // 2-4 items, authored order, never shuffled
//       { id: 'circle', label: 'circle', svg: 'circle', correct: true },
//       { id: 'square', label: 'square', svg: 'square' },
//     ],
//     target: null,             // drag only: { zone: 'basket', count: 2 }
//     answer: null,             // sequence only: ['first', 'next', 'last']
//   }
//
//   tap      exactly one choice has correct: true; the answer is a choice id.
//   drag     the choices are the draggable items on the tray; target.zone is
//            an SVG key for the drop zone and target.count (1..choices.length)
//            is how many to drop. No choice is flagged correct - the answer is
//            a count, so a "correct item" would mean nothing. The answer is
//            { count }.
//   sequence no choice is flagged correct; step.answer lists every choice id
//            exactly once, in order. The answer is an array of choice ids.
//   Every choice.svg (and drag target.zone) must be a key in ./svg.js.
//
// render IS PURE AND RETURNS A DESCRIPTOR, NOT DOM. That keeps the engine
// testable in Node and lets any renderer (the shell, the debug harness, a
// test) draw the same lesson. The shell turns the descriptor into DOM.
//
//   renderStep(step, ctx) ctx = { index, total, settings, isFirst, isLast }
//   -> { prompt, audio, mode, choices: [{ id, label, svg }], target,
//        progress: { index, total } }
//
// The descriptor's choices never carry `correct`, and it never carries
// `answer`: the renderer is not told the answer.
//
// check(answer, step) -> { correct: boolean, highlight }
//   tap      highlight = the correct choice id when wrong, null when right
//   drag     correct when answer.count === target.count; highlight is
//            always null (the shell reveals the count from step.target)
//   sequence element-wise compare; highlight = the first wrong index
//            (a number), or null when right
//   check never throws. A malformed answer is
//   { correct: false, highlight: <correct id, 0 for sequence, or null> }.

import { SVG } from './svg.js';

export const LESSON_SHAPE = ['id', 'title', 'order', 'steps', 'render', 'check'];
export const MODES = ['tap', 'drag', 'sequence'];
export const MIN_STEPS = 8;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

// Must equal LESSON_ORDER in src/routes/progress.js (the server's unlock
// chain); test/phase4-engine.test.js asserts the two are identical.
export const CANONICAL_ORDER = Object.freeze([
  '01-shapes', '02-numbers', '03-nouns', '04-verbs', '05-colors',
  '06-emotions', '07-opposites', '08-sequencing', '09-prepositions', '10-math',
]);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const hasSvg = (k) => typeof k === 'string' && Object.hasOwn(SVG, k);

function correctChoiceId(step) {
  const c = Array.isArray(step?.choices) ? step.choices.find((x) => x && x.correct === true) : null;
  return c ? c.id : null;
}

// Shared check used by every lesson. Never throws.
export function checkStep(answer, step) {
  const mode = step?.mode;
  if (mode === 'drag') {
    const want = step?.target?.count;
    const ok = isObj(answer) && Number.isInteger(answer.count) && answer.count === want;
    return { correct: ok, highlight: null };
  }
  if (mode === 'sequence') {
    const want = Array.isArray(step?.answer) ? step.answer : [];
    if (!Array.isArray(answer) || want.length === 0) return { correct: false, highlight: 0 };
    for (let i = 0; i < want.length; i++) {
      if (answer[i] !== want[i]) return { correct: false, highlight: i };
    }
    // Extra trailing items are wrong too; the first extra index is the cue.
    if (answer.length !== want.length) return { correct: false, highlight: want.length };
    return { correct: true, highlight: null };
  }
  const right = correctChoiceId(step);
  if (typeof answer === 'string' && right !== null && answer === right) {
    return { correct: true, highlight: null };
  }
  return { correct: false, highlight: right };
}

// Shared pure render used by every lesson.
export function renderStep(step, ctx = {}) {
  const total = Number.isInteger(ctx.total) ? ctx.total : null;
  return {
    prompt: step.prompt,
    audio: step.audio,
    mode: step.mode,
    choices: step.choices.map(({ id, label, svg }) => ({ id, label, svg })),
    target: step.target ? { zone: step.target.zone, count: step.target.count } : null,
    progress: { index: Number.isInteger(ctx.index) ? ctx.index : 0, total },
  };
}

// --- Authoring helpers. They only build plain objects; validateLesson is the
// gate. Choice order is exactly the order written in the lesson file.

// A choice; a bare string means id === label === svg key.
export function choice(id, label = id, svg = id) {
  return { id, label, svg };
}
const toChoice = (c) => (typeof c === 'string' ? choice(c) : { ...c });

export function tap(id, prompt, audio, choices, correctId) {
  return {
    id, prompt, audio, mode: 'tap',
    choices: choices.map(toChoice).map((c) => (c.id === correctId ? { ...c, correct: true } : c)),
    target: null, answer: null,
  };
}

export function drag(id, prompt, audio, choices, target) {
  return { id, prompt, audio, mode: 'drag', choices: choices.map(toChoice), target: { ...target }, answer: null };
}

export function sequence(id, prompt, audio, choices, answer) {
  return { id, prompt, audio, mode: 'sequence', choices: choices.map(toChoice), target: null, answer: [...answer] };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// Builds and freezes a lesson module's default export with the shared pure
// render/check. Frozen so nothing downstream can edit the curriculum.
export function defineLesson({ id, title, order, steps }) {
  return deepFreeze({ id, title, order, steps, render: renderStep, check: checkStep });
}

function fail(id, msg) {
  throw new Error(`lesson ${typeof id === 'string' ? `"${id}"` : '(no id)'}: ${msg}`);
}

function validateStep(lessonId, step, i) {
  const where = `step ${i}${isObj(step) && typeof step.id === 'string' ? ` ("${step.id}")` : ''}`;
  if (!isObj(step)) fail(lessonId, `${where} is not an object`);
  if (!isText(step.id)) fail(lessonId, `${where} has no string id`);
  if (!isText(step.prompt)) fail(lessonId, `${where} has no prompt string`);
  if (!isText(step.audio)) fail(lessonId, `${where} has no audio string`);
  if (!MODES.includes(step.mode)) fail(lessonId, `${where} mode must be one of ${MODES.join(', ')}`);
  if (!Array.isArray(step.choices)) fail(lessonId, `${where} choices must be an array`);
  if (step.choices.length < MIN_CHOICES || step.choices.length > MAX_CHOICES) {
    fail(lessonId, `${where} has ${step.choices.length} choices; must be ${MIN_CHOICES}-${MAX_CHOICES}`);
  }

  const ids = new Set();
  step.choices.forEach((c, j) => {
    if (!isObj(c)) fail(lessonId, `${where} choice ${j} is not an object`);
    if (!isText(c.id)) fail(lessonId, `${where} choice ${j} has no string id`);
    if (ids.has(c.id)) fail(lessonId, `${where} has duplicate choice id "${c.id}"`);
    ids.add(c.id);
    if (!isText(c.label)) fail(lessonId, `${where} choice "${c.id}" has no label`);
    if (typeof c.svg !== 'string') fail(lessonId, `${where} choice "${c.id}" has no svg key`);
    if (!hasSvg(c.svg)) fail(lessonId, `${where} choice "${c.id}" uses unknown svg key "${c.svg}"`);
  });

  const flagged = step.choices.filter((c) => c.correct === true).length;
  if (step.mode === 'tap') {
    if (flagged !== 1) fail(lessonId, `${where} must have exactly one correct choice, has ${flagged}`);
  } else if (flagged !== 0) {
    fail(lessonId, `${where} is ${step.mode} mode and must not flag a choice correct`);
  }

  if (step.mode === 'drag') {
    const t = step.target;
    if (!isObj(t)) fail(lessonId, `${where} is drag mode and needs target { zone, count }`);
    if (!hasSvg(t.zone)) fail(lessonId, `${where} target.zone "${t.zone}" is not an svg key`);
    if (!Number.isInteger(t.count) || t.count < 1 || t.count > step.choices.length) {
      fail(lessonId, `${where} target.count must be an integer 1-${step.choices.length}`);
    }
  } else if (step.target != null) {
    fail(lessonId, `${where} target is only allowed in drag mode`);
  }

  if (step.mode === 'sequence') {
    const a = step.answer;
    const sameSet = Array.isArray(a) && a.length === ids.size && new Set(a).size === a.length && a.every((x) => ids.has(x));
    if (!sameSet) fail(lessonId, `${where} answer must list every choice id exactly once`);
  } else if (step.answer != null) {
    fail(lessonId, `${where} answer is only allowed in sequence mode`);
  }
}

// Throws with a message naming the lesson id and the exact violation.
export function validateLesson(lesson) {
  if (!isObj(lesson)) fail(null, 'module default export is not an object');
  const id = lesson.id;
  for (const key of LESSON_SHAPE) {
    if (!Object.hasOwn(lesson, key)) fail(id, `missing key "${key}"`);
  }
  if (!isText(id)) fail(id, 'id must be a non-empty string');
  if (!isText(lesson.title)) fail(id, 'title must be a non-empty string');
  if (!Number.isInteger(lesson.order) || lesson.order < 1 || lesson.order > 10) {
    fail(id, 'order must be an integer 1-10');
  }
  if (!id.startsWith(`${String(lesson.order).padStart(2, '0')}-`)) {
    fail(id, `id prefix does not match order ${lesson.order}`);
  }
  if (typeof lesson.render !== 'function') fail(id, 'render must be a function');
  if (typeof lesson.check !== 'function') fail(id, 'check must be a function');
  if (!Array.isArray(lesson.steps)) fail(id, 'steps must be an array');
  if (lesson.steps.length < MIN_STEPS) {
    fail(id, `has ${lesson.steps.length} steps; needs at least ${MIN_STEPS}`);
  }
  const stepIds = new Set();
  lesson.steps.forEach((s, i) => {
    validateStep(id, s, i);
    if (stepIds.has(s.id)) fail(id, `duplicate step id "${s.id}"`);
    stepIds.add(s.id);
  });
  return lesson;
}

// Validates every lesson, asserts no duplicate ids or orders, and asserts the
// order derived from each lesson's `order` field is exactly CANONICAL_ORDER.
// A mismatch throws; it is never silently sorted into shape.
export function validateCurriculum(lessons) {
  if (!Array.isArray(lessons)) throw new Error('curriculum: expected an array of lessons');
  lessons.forEach(validateLesson);
  const ids = new Set();
  const orders = new Set();
  for (const l of lessons) {
    if (ids.has(l.id)) throw new Error(`curriculum: duplicate lesson id "${l.id}"`);
    if (orders.has(l.order)) throw new Error(`curriculum: duplicate order ${l.order} ("${l.id}")`);
    ids.add(l.id);
    orders.add(l.order);
  }
  const ordered = [...lessons].sort((a, b) => a.order - b.order);
  const derived = ordered.map((l) => l.id);
  if (derived.length !== CANONICAL_ORDER.length || derived.some((id, i) => id !== CANONICAL_ORDER[i])) {
    throw new Error(`curriculum: derived order [${derived.join(', ')}] is not the canonical order [${CANONICAL_ORDER.join(', ')}]`);
  }
  return ordered;
}
