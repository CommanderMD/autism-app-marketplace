// Emotion Matcher content: every question the game can ask, frozen, checked
// by validateItems() when this module loads. A bad item stops the app from
// starting rather than reaching a child.
//
// All text here is an i18n key (public/i18n/*.json, emotionMatch.*), never
// English, so the UI layer has nothing to translate inline. Original content
// written for this project.
//
// Item shape:
//   id        unique, e.g. 't2-angry'
//   type      1 face -> word, 2 word -> face, 3 situation -> face
//   prompt    i18n key shown on screen
//   audio     i18n key spoken when the item appears and on replay
//   choices   3-4 of { id: emotion, face: faces.js key }; ids unique
//   correctId the one right choice id
//   face      type 1 only: the big face the child names
//   word      type 2 only: the emotion asked for
//   scenario, scene, alternatives   type 3 only (see below)

import { EMOTIONS, INTENSITIES, BASE_INTENSITY, faceKey, hasFace, hasScene } from './faces.js';

export const TASK_TYPES = Object.freeze([1, 2, 3]);
export const MIN_PER_TYPE = 8;
export const MIN_CHOICES = 3;
export const MAX_CHOICES = 4;

// Type 2 distractors must be near-misses: faces a child could confuse with
// the target, from the same set. Never the opposite feeling (no happy for
// angry). The validator checks every Type 2 distractor is listed here.
export const NEAR = Object.freeze({
  happy: Object.freeze(['proud', 'calm']),
  sad: Object.freeze(['tired', 'scared']),
  angry: Object.freeze(['sad', 'scared']),
  scared: Object.freeze(['surprised', 'sad']),
  surprised: Object.freeze(['scared', 'happy']),
  tired: Object.freeze(['calm', 'sad']),
  calm: Object.freeze(['tired', 'happy']),
  proud: Object.freeze(['happy', 'calm']),
});

const c = (emotion) => ({ id: emotion, face: faceKey(emotion, BASE_INTENSITY) });

// Type 1 - Face -> Word. The easiest task, so the two wrong words are
// clearly different feelings, not near-misses. The answer is one word.
const faceToWord = (emotion, order) => ({
  id: `t1-${emotion}`,
  type: 1,
  prompt: 'emotionMatch.prompt_face',
  audio: 'emotionMatch.audio_face',
  face: faceKey(emotion, BASE_INTENSITY),
  choices: order.map(c),
  correctId: emotion,
});

// Type 2 - Word -> Face. Distractors come from NEAR[word].
const wordToFace = (emotion, order) => ({
  id: `t2-${emotion}`,
  type: 2,
  word: emotion,
  prompt: 'emotionMatch.prompt_word',
  audio: 'emotionMatch.audio_word',
  choices: order.map(c),
  correctId: emotion,
});

// Type 3 - Situation -> Face. A scenario must have ONE defensible answer
// among its choices. If a scenario could reasonably produce two of the
// offered feelings, it is a bad item: rewrite it (or swap the distractor)
// rather than shipping it. `alternatives` is the hand-authored list of other
// offered choices that a reasonable child could defend; it must be empty, and
// a non-empty array means the item needs rewriting - validateItems throws.
// The comment above each item names the feelings that were considered and
// deliberately kept out of its choices.
const situation = (id, correctId, order, alternatives = []) => ({
  id: `t3-${id}`,
  type: 3,
  scenario: `emotionMatch.scenario.${id}`,
  scene: id,
  prompt: 'emotionMatch.prompt_situation',
  audio: `emotionMatch.scenario.${id}`,
  choices: order.map(c),
  correctId,
  alternatives,
});

const RAW = [
  faceToWord('happy', ['happy', 'sad', 'angry']),
  faceToWord('sad', ['happy', 'sad', 'surprised']),
  faceToWord('angry', ['calm', 'happy', 'angry']),
  faceToWord('scared', ['scared', 'proud', 'calm']),
  faceToWord('surprised', ['tired', 'surprised', 'sad']),
  faceToWord('tired', ['happy', 'surprised', 'tired']),
  faceToWord('calm', ['angry', 'calm', 'scared']),
  faceToWord('proud', ['sad', 'scared', 'proud']),

  wordToFace('happy', ['proud', 'happy', 'calm']),
  wordToFace('sad', ['sad', 'tired', 'scared']),
  wordToFace('angry', ['sad', 'scared', 'angry']),
  wordToFace('scared', ['surprised', 'scared', 'sad']),
  wordToFace('surprised', ['surprised', 'happy', 'scared']),
  wordToFace('tired', ['calm', 'sad', 'tired']),
  wordToFace('calm', ['tired', 'calm', 'happy']),
  wordToFace('proud', ['happy', 'calm', 'proud']),

  // Birthday song and cake: happy. Proud and surprised kept out (it is not an
  // achievement, and a birthday is expected).
  situation('birthday', 'happy', ['sad', 'happy', 'tired']),
  // Balloon lost for good: sad. Angry kept out (no one did it on purpose).
  situation('balloon', 'sad', ['sad', 'proud', 'calm']),
  // Tower knocked down on purpose, then laughed at: angry. Sad kept out - it
  // is also defensible, so it is not offered.
  situation('tower', 'angry', ['happy', 'angry', 'calm']),
  // Loud thunder in the dark: scared. Surprised kept out (a sudden noise can
  // be either).
  situation('thunder', 'scared', ['proud', 'happy', 'scared']),
  // Grandpa arrives without warning: surprised. Happy kept out - also
  // defensible, so it is not offered.
  situation('visit', 'surprised', ['surprised', 'tired', 'angry']),
  // Played all day, eyes closing at night: tired. Calm kept out.
  situation('long-day', 'tired', ['angry', 'tired', 'surprised']),
  // Soft grass and a quiet bird, nothing rushing: calm. Happy and tired kept
  // out.
  situation('garden', 'calm', ['scared', 'angry', 'calm']),
  // Finished the hard puzzle alone: proud. Happy kept out - also defensible.
  situation('puzzle', 'proud', ['proud', 'sad', 'scared']),
  // A strange big dog runs at you barking: scared. Surprised and angry kept
  // out.
  situation('dog', 'scared', ['calm', 'scared', 'proud']),
  // A friend shares a cookie: happy. Proud and surprised kept out.
  situation('snack', 'happy', ['angry', 'scared', 'happy']),
];

const isKey = (v) => typeof v === 'string' && /^emotionMatch\.[a-z0-9_.-]+$/.test(v);

// Throws an Error naming the item and the rule it breaks.
export function validateItem(item) {
  const where = `emotion-match item ${item && item.id ? item.id : '(no id)'}`;
  const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
  if (!item || typeof item !== 'object') fail('not an object');
  if (typeof item.id !== 'string' || !/^t[123]-[a-z0-9-]+$/.test(item.id)) fail('id must look like t1-name');
  if (!TASK_TYPES.includes(item.type)) fail('type must be 1, 2 or 3');
  if (!isKey(item.prompt)) fail('prompt must be an emotionMatch.* i18n key');
  if (!isKey(item.audio)) fail('audio must be an emotionMatch.* i18n key');
  if (!Array.isArray(item.choices)) fail('choices must be an array');
  if (item.choices.length < MIN_CHOICES || item.choices.length > MAX_CHOICES) {
    fail(`choices must number ${MIN_CHOICES}-${MAX_CHOICES}`);
  }
  const ids = new Set();
  for (const ch of item.choices) {
    if (!ch || typeof ch.id !== 'string' || !ch.id) fail('every choice needs an id');
    if (ids.has(ch.id)) fail(`duplicate choice id ${ch.id}`);
    ids.add(ch.id);
    if (!EMOTIONS.includes(ch.id)) fail(`choice ${ch.id} is not an emotion`);
    if (!hasFace(ch.face)) fail(`unknown face key ${ch.face}`);
  }
  if (typeof item.correctId !== 'string' || !item.correctId) fail('correctId is required');
  if (!ids.has(item.correctId)) fail(`correctId ${item.correctId} is not one of the choices`);

  if (item.type === 1) {
    if (!hasFace(item.face)) fail(`unknown face key ${item.face}`);
    if (!item.face.startsWith(`${item.correctId}-`)) fail('the face shown must be the correct emotion');
  }
  if (item.type === 2) {
    if (item.word !== item.correctId) fail('word must be the correct emotion');
    const near = NEAR[item.word] || [];
    for (const ch of item.choices) {
      if (ch.id !== item.correctId && !near.includes(ch.id)) fail(`distractor ${ch.id} is not a near-miss for ${item.word}`);
    }
  }
  if (item.type === 3) {
    if (!isKey(item.scenario)) fail('scenario must be an emotionMatch.* i18n key');
    if (!hasScene(item.scene)) fail(`unknown scene ${item.scene}`);
    if (!Array.isArray(item.alternatives)) fail('alternatives must be an array');
    // One correctId, no ties: any second defensible answer means rewrite.
    if (item.alternatives.length !== 0) fail(`has a second defensible answer (${item.alternatives.join(', ')}); rewrite the scenario`);
  } else if ('scenario' in item || 'alternatives' in item) {
    fail('only type 3 items have a scenario');
  }
  return item;
}

export function validateItems(items) {
  if (!Array.isArray(items)) throw new Error('emotion-match items must be an array');
  const seen = new Set();
  for (const item of items) {
    validateItem(item);
    if (seen.has(item.id)) throw new Error(`emotion-match item ${item.id}: duplicate id`);
    seen.add(item.id);
  }
  for (const type of TASK_TYPES) {
    const n = items.filter((i) => i.type === type).length;
    if (n < MIN_PER_TYPE) throw new Error(`emotion-match: type ${type} has ${n} items, needs at least ${MIN_PER_TYPE}`);
  }
  return items;
}

// The intensity layer: the same emotion again, as three faces of rising
// intensity, asking for one of them ("which one is very angry?"). Built from a
// base item, never authored, so every base item has one.
export function intensityItem(item, target) {
  if (!INTENSITIES.includes(target)) throw new Error(`unknown intensity ${target}`);
  const emotion = item.correctId;
  return {
    id: `${item.id}-${target}`,
    type: item.type,
    layer: 'intensity',
    word: emotion,
    amount: target,
    prompt: 'emotionMatch.prompt_intensity',
    audio: 'emotionMatch.audio_intensity',
    choices: INTENSITIES.map((i) => ({ id: faceKey(emotion, i), face: faceKey(emotion, i), emotion, intensity: i })),
    correctId: faceKey(emotion, target),
  };
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};

export const ITEMS = deepFreeze(validateItems(RAW));
export const itemsOfType = (type, items = ITEMS) => items.filter((i) => i.type === type);
