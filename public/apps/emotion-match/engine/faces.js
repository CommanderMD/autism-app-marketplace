// Emotion Matcher faces and scene pictures: key -> SVG markup string.
//
// This app's own frozen library. It follows the Act 1 drawing conventions
// (act1/engine/svg.js) but does not import or copy that file, so the two apps
// can change their pictures independently.
//
// Rules every entry follows (test/emotion-match-engine.test.js checks them):
// - self-contained <svg viewBox="0 0 100 100" aria-hidden="true">. The face is
//   never its own accessible name: the shell names each choice by position
//   until the answer is revealed (see js/main.js), so a picture must not leak
//   its emotion to a screen reader.
// - ink is currentColor with a 2-unit stroke, so every picture follows the
//   shell's text colour and its high-contrast mode. No fills in colour: an
//   emotion or an intensity is never shown by colour alone, or by size alone.
// - no <script>, <image>, <text>, href, event attributes or "http".
//
// Keys: `${emotion}-${intensity}`, e.g. `angry-very`. Every emotion has all
// three intensities. Base items (no intensity layer) use the `quite` face.

export const EMOTIONS = Object.freeze(['happy', 'sad', 'angry', 'scared', 'surprised', 'tired', 'calm', 'proud']);
export const INTENSITIES = Object.freeze(['little', 'quite', 'very']);
export const BASE_INTENSITY = 'quite';

export const faceKey = (emotion, intensity = BASE_INTENSITY) => `${emotion}-${intensity}`;

const STROKE = 2;
const wrap = (body) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`;
const line = (d) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`;
const solid = (d) => `<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
const dot = (x, y, r = 3.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`;
const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="currentColor" stroke-width="${STROKE}"/>`;
const oval = (x, y, rx, ry) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="currentColor" stroke-width="${STROKE}"/>`;

// Every face shares this outline; only brows, eyes, mouth and marks change.
const head = ring(50, 52, 40);
const face = (...features) => head + features.join('');
const dotEyes = (y = 44, r = 3.5) => dot(36, y, r) + dot(64, y, r);
// Mirror a left-side path across x = 50 by drawing both from coordinates.
const brows = (x1, y1, x2, y2) => line(`M${x1} ${y1} L${x2} ${y2} M${100 - x1} ${y1} L${100 - x2} ${y2}`);
const archBrows = (y, h) => line(`M29 ${y} Q36 ${y - h} 43 ${y} M57 ${y} Q64 ${y - h} 71 ${y}`);

const FACES = {
  // HAPPY - the mouth's upward curve deepens with intensity.
  //   a little: dot eyes, a shallow closed smile
  //   quite:    dot eyes, a deep closed smile
  //   very:     eyes squeezed into upward crescents, the mouth open wide
  'happy-little': face(dotEyes(), line('M38 67 Q50 73 62 67')),
  'happy-quite': face(dotEyes(), line('M32 63 Q50 81 68 63')),
  'happy-very': face(line('M30 46 Q36 38 42 46 M58 46 Q64 38 70 46'), solid('M28 61 Q50 92 72 61 Z')),

  // SAD - the inner ends of the brows lift higher and the frown deepens.
  //   a little: brows almost level, a slight frown
  //   quite:    brows tilted up in the middle, a clear frown
  //   very:     brows steeply tilted, a deep frown, and a tear under one eye
  'sad-little': face(brows(28, 35, 42, 33), dotEyes(), line('M38 73 Q50 68 62 73')),
  'sad-quite': face(brows(28, 37, 42, 30), dotEyes(), line('M34 75 Q50 63 66 75')),
  'sad-very': face(brows(28, 39, 42, 26), dotEyes(46),
    line('M36 53 Q41 60 36 64 Q31 60 36 53 Z'), line('M32 79 Q50 58 68 79')),

  // ANGRY - the brows slant down toward the nose, steeper and lower each
  // step (the opposite tilt to sad); the mouth goes flat, then a frown, then
  // clenched teeth.
  //   a little: brows slightly slanted, mouth a flat line
  //   quite:    brows clearly slanted, mouth a tight frown
  //   very:     brows sharply slanted, eyes narrowed, teeth clenched
  'angry-little': face(brows(28, 32, 44, 35), dotEyes(), line('M40 70 H60')),
  'angry-quite': face(brows(28, 30, 44, 38), dotEyes(), line('M36 73 Q50 64 64 73')),
  'angry-very': face(brows(26, 28, 46, 40), dotEyes(46, 2.5),
    line('M34 66 H66 V77 H34 Z M34 71.5 H66 M42 66 V77 M50 66 V77 M58 66 V77')),

  // SCARED - the eyes open wider (a ring around the pupil grows), the brows
  // lift and pull together, and the mouth goes from a small wobble to a wide
  // wobble to a stretched-open mouth. Brows tilt; surprised brows do not.
  //   a little: small eye rings, brows a little raised, a small wobbly mouth
  //   quite:    larger eye rings, brows tilted up, a wide wobbly mouth
  //   very:     very wide eye rings, brows tilted steeply, mouth stretched open
  'scared-little': face(line('M28 32 Q36 29 44 31 M72 32 Q64 29 56 31'),
    ring(36, 44, 5) + dot(36, 44, 2) + ring(64, 44, 5) + dot(64, 44, 2),
    line('M42 70 Q46 67 50 70 Q54 73 58 70')),
  'scared-quite': face(brows(28, 30, 44, 25),
    ring(36, 44, 7) + dot(36, 44, 2) + ring(64, 44, 7) + dot(64, 44, 2),
    line('M34 72 Q38 66 42 72 Q46 78 50 72 Q54 66 58 72 Q62 78 66 72')),
  'scared-very': face(brows(28, 27, 44, 19),
    ring(36, 44, 9) + dot(36, 44, 2) + ring(64, 44, 9) + dot(64, 44, 2),
    line('M34 70 Q50 63 66 70 Q66 84 50 84 Q34 84 34 70 Z')),

  // SURPRISED - level, curved brows rise higher; the eyes grow rounder; the
  // mouth is a round "O" that grows. Never tilted brows, never a wobble.
  //   a little: brows a little up, small round eyes, a small "o"
  //   quite:    brows high, round eyes, a medium "O"
  //   very:     brows very high, big round eyes, a big "O"
  'surprised-little': face(archBrows(33, 4), ring(36, 44, 4) + dot(36, 44, 2) + ring(64, 44, 4) + dot(64, 44, 2), oval(50, 70, 3.5, 3.5)),
  'surprised-quite': face(archBrows(29, 6), ring(36, 44, 6) + dot(36, 44, 2) + ring(64, 44, 6) + dot(64, 44, 2), oval(50, 71, 5, 7)),
  'surprised-very': face(archBrows(25, 9), ring(36, 44, 8) + dot(36, 44, 2) + ring(64, 44, 8) + dot(64, 44, 2), oval(50, 72, 8, 11)),

  // TIRED - the eyelids close further each step and the face sags.
  //   a little: heavy lids half over the eyes, a flat mouth
  //   quite:    lids shut flat with a bag under each eye, mouth drooping
  //   very:     lids shut, two bags under each eye, a yawn, and a "z" mark
  'tired-little': face(line('M30 43 H42 M58 43 H70'), dot(36, 46, 2.5) + dot(64, 46, 2.5), line('M42 71 H58')),
  'tired-quite': face(line('M30 45 H42 M58 45 H70 M32 51 Q36 53 40 51 M60 51 Q64 53 68 51'), line('M40 72 Q50 69 60 72')),
  'tired-very': face(line('M30 47 H42 M58 47 H70 M32 52 Q36 54 40 52 M60 52 Q64 54 68 52 M32 56 Q36 58 40 56 M60 56 Q64 58 68 56'),
    oval(50, 74, 6, 8), line('M74 8 H84 L74 18 H84')),

  // CALM - the face relaxes: the eyes go from open, to softly lowered, to
  // gently closed in an upward curve; the brows stay level and lift slightly;
  // the mouth stays a small soft smile (never the deep smile of happy).
  //   a little: open dot eyes, level brows, a small smile
  //   quite:    eyes softly lowered to short curves, level brows, small smile
  //   very:     eyes fully closed in wide soft curves, brows lifted and level
  'calm-little': face(line('M30 34 H42 M58 34 H70'), dotEyes(), line('M42 69 Q50 72 58 69')),
  'calm-quite': face(line('M30 33 H42 M58 33 H70'), line('M32 44 Q36 47 40 44 M60 44 Q64 47 68 44'), line('M41 69 Q50 73 59 69')),
  'calm-very': face(line('M29 30 H43 M57 30 H71'), line('M29 43 Q36 51 43 43 M57 43 Q64 51 71 43'), line('M40 69 Q50 74 60 69')),

  // PROUD - the chin lifts: every feature rides higher on the face with each
  // step (4 units, then 8), the arched brows rise, and the closed-mouth smile
  // widens and lifts at the corners. Proud never opens its mouth (happy-very
  // does), and its eyes turn into contented arcs from "quite" up.
  //   a little: dot eyes, slightly raised brows, a modest closed smile
  //   quite:    features lifted, contented arc eyes, a wider closed smile
  //   very:     features lifted most, high brows, widest smile with corner ticks
  'proud-little': face(archBrows(33, 3), dotEyes(44), line('M38 66 Q50 73 62 66')),
  'proud-quite': face(archBrows(29, 4), line('M31 42 Q36 37 41 42 M59 42 Q64 37 69 42'), line('M34 61 Q50 71 66 61')),
  'proud-very': face(archBrows(24, 5), line('M31 38 Q36 33 41 38 M59 38 Q64 33 69 38'),
    line('M30 56 Q50 69 70 56 M28 53 L30 56 M72 53 L70 56')),
};

// Scene pictures for Type 3. Objects and places only, never a face, so the
// picture cannot answer the question for the child.
const SCENES = {
  birthday: line('M24 56 H76 V88 H24 Z M24 68 H76') + line('M36 56 V44 M50 56 V44 M64 56 V44')
    + solid('M36 36 Q39 40 36 42 Q33 40 36 36 Z M50 36 Q53 40 50 42 Q47 40 50 36 Z M64 36 Q67 40 64 42 Q61 40 64 36 Z'),
  balloon: oval(70, 22, 12, 15) + line('M70 37 Q64 52 72 64 Q78 74 70 84') + line('M10 92 H90') + line('M30 70 V54 M24 60 L30 54 L36 60'),
  tower: line('M14 92 H86') + line('M20 80 H38 V92 H20 Z') + line('M44 74 L60 70 L63 82 L47 86 Z') + line('M64 50 L78 58 L72 70 L58 62 Z') + line('M30 40 L44 36 L47 48 L33 52 Z'),
  thunder: line('M22 46 Q14 46 14 38 Q14 28 26 30 Q30 16 46 20 Q56 10 68 22 Q84 20 84 34 Q90 46 76 46 Z') + solid('M50 48 L40 70 H50 L44 92 L64 62 H54 L60 48 Z'),
  visit: line('M30 14 H70 V92 H30 Z') + line('M30 14 L16 20 V92 L30 92') + dot(50, 40, 7) + line('M50 47 V72 M50 56 L40 64 M50 56 L60 64 M50 72 L42 88 M50 72 L58 88'),
  'long-day': line('M10 92 H90') + line('M76 18 A14 14 0 1 0 86 34 A11 11 0 1 1 76 18 Z') + line('M14 70 H60 V82 H14 Z M14 82 V92 M60 82 V92 M14 70 V58') + ring(30, 50, 9),
  garden: line('M6 80 Q18 72 30 80 Q42 72 54 80 Q66 72 78 80 Q88 74 96 80') + line('M6 92 H94') + ring(24, 24, 9)
    + line('M56 40 Q62 34 68 40 Q74 34 80 40') + line('M18 80 L16 70 M26 80 L28 70 M70 80 L68 70 M80 80 L82 70'),
  puzzle: line('M18 18 H82 V82 H18 Z M50 18 V82 M18 50 H82') + ring(50, 34, 4) + ring(34, 50, 4) + ring(66, 50, 4) + ring(50, 66, 4),
  dog: solid('M20 52 Q20 40 34 40 H60 Q66 40 66 48 V62 H20 Z') + solid('M62 32 Q72 26 80 32 L82 44 Q74 50 64 46 Z')
    + line('M26 62 V80 M36 62 V80 M50 62 V80 M60 62 V80 M20 48 Q10 42 12 32 M86 30 L94 24 M88 38 L96 38 M86 46 L94 52') + line('M6 92 H94'),
  snack: oval(50, 64, 40, 14) + line('M22 58 A14 14 0 0 1 46 50 L40 62 Z M78 58 A14 14 0 0 0 54 50 L60 62 Z') + dot(34, 54, 1.5) + dot(66, 54, 1.5),
};

export const FACE_SVG = Object.freeze(Object.fromEntries(Object.entries(FACES).map(([k, v]) => [k, wrap(v)])));
export const SCENE_SVG = Object.freeze(Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, wrap(v)])));

export const hasFace = (key) => Object.prototype.hasOwnProperty.call(FACE_SVG, key);
export const hasScene = (key) => Object.prototype.hasOwnProperty.call(SCENE_SVG, key);
export const faceSvg = (key) => (hasFace(key) ? FACE_SVG[key] : null);
export const sceneSvg = (key) => (hasScene(key) ? SCENE_SVG[key] : null);

// "angry-very" -> { emotion: 'angry', intensity: 'very' }, or null.
export function parseFaceKey(key) {
  const m = /^([a-z]+)-([a-z]+)$/.exec(String(key));
  if (!m || !EMOTIONS.includes(m[1]) || !INTENSITIES.includes(m[2])) return null;
  return { emotion: m[1], intensity: m[2] };
}
