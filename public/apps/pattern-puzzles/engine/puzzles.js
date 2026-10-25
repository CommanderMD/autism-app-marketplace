// Pattern Puzzles content: 31 original puzzles in four task types, frozen
// and checked by validatePuzzles() at load, so a broken puzzle stops the
// module from loading instead of reaching a child.
//
// Every puzzle has ONE rule a child could say out loud (`rule`). If a rule
// needs two sentences, the puzzle is too hard or ambiguous and does not ship.
// After every answer the shell shows and speaks that sentence; the English
// here is the source, and en.json/es.json carry it as
// patternPuzzles.rule.<id> (a test keeps en.json equal to this file).
//
// A cell is a shape key from shapes.js or { shape, fill, size, turn }; the
// defaults are solid, big, unturned. Exactly one cell is null: that is the
// gap the child fills. Every puzzle has exactly three choices.
//
//   Type 1  continue the sequence  a row with the last cell missing
//   Type 2  odd one out            a 2x2 or 3x3 grid that all shares one
//                                  property; the gap takes the one that breaks it
//   Type 3  complete the matrix    2x2 or 3x3; one rule across, one rule down
//   Type 4  growing pattern        three counts of one shape, then the fourth

import {
  SHAPES, FILLS, SIZES, TURNS, MAX_COUNT,
  hasShape, normaliseCell, propertyOf, cellKey,
} from './shapes.js';

export const TASK_TYPES = Object.freeze([1, 2, 3, 4]);
export const CHOICE_COUNT = 3;

// Type 1 repeating units. Each letter is one distinct cell.
export const PATTERNS = Object.freeze({
  AB: Object.freeze([0, 1]),
  AAB: Object.freeze([0, 0, 1]),
  ABB: Object.freeze([0, 1, 1]),
  ABC: Object.freeze([0, 1, 2]),
});

// Type 4 growth rules. Each is something a child can check by counting.
export const GROWTHS = Object.freeze(['plus1', 'double', 'alternate', 'repeat']);

// Properties a type 2 or type 3 puzzle can vary. `sides` comes from the
// shape and is handled on its own (see oddOneOut below).
const BASE_PROPS = Object.freeze(['shape', 'fill', 'size', 'turn']);

// ------------------------------------------------------------------ content

const c = (shape, fill = 'solid', extra = {}) => ({ shape, fill, ...extra });

// Type 1. Comment: the distractors must be PLAUSIBLE, i.e. present in the
// row. A random shape is not a distractor, it is noise. So every distractor
// is drawn from the row: its shape and its fill are both already on screen.
// An AB row has only two cells to borrow from, so the second distractor is a
// mix-up of the two (the wrong shape wearing the right fill) - still made of
// what the child can see, and still wrong by shape alone, so the rule never
// needs the colour to be said.
const TYPE1 = [
  {
    id: 'pp-t1-01', type: 1, pattern: 'AB',
    rule: 'Circle, square, circle, square: they take turns.',
    cells: [c('circle'), c('square', 'stripes'), c('circle'), c('square', 'stripes'), c('circle'), null],
    choices: [{ id: 'a', ...c('square', 'stripes') }, { id: 'b', ...c('circle') }, { id: 'c', ...c('circle', 'stripes') }],
    correctId: 'a',
  },
  {
    id: 'pp-t1-02', type: 1, pattern: 'AB',
    rule: 'Star, heart, star, heart: they take turns.',
    cells: [c('star', 'dots'), c('heart'), c('star', 'dots'), c('heart'), null],
    choices: [{ id: 'a', ...c('heart') }, { id: 'b', ...c('star', 'dots') }, { id: 'c', ...c('heart', 'dots') }],
    correctId: 'b',
  },
  {
    id: 'pp-t1-03', type: 1, pattern: 'AAB',
    rule: 'Two triangles, then a moon, again and again.',
    cells: [c('triangle'), c('triangle'), c('moon', 'stripes'), c('triangle'), c('triangle'), null],
    choices: [{ id: 'a', ...c('triangle') }, { id: 'b', ...c('triangle', 'stripes') }, { id: 'c', ...c('moon', 'stripes') }],
    correctId: 'c',
  },
  {
    id: 'pp-t1-04', type: 1, pattern: 'AAB',
    rule: 'Two hexagons, then a cross, again and again.',
    cells: [c('hexagon', 'outline'), c('hexagon', 'outline'), c('cross'), c('hexagon', 'outline'), null],
    choices: [{ id: 'a', ...c('cross') }, { id: 'b', ...c('hexagon', 'outline') }, { id: 'c', ...c('cross', 'outline') }],
    correctId: 'b',
  },
  {
    id: 'pp-t1-05', type: 1, pattern: 'ABB',
    rule: 'One diamond, then two circles, again and again.',
    cells: [c('diamond', 'stripes'), c('circle'), c('circle'), c('diamond', 'stripes'), c('circle'), null],
    choices: [{ id: 'a', ...c('diamond', 'stripes') }, { id: 'b', ...c('circle') }, { id: 'c', ...c('diamond') }],
    correctId: 'b',
  },
  {
    id: 'pp-t1-06', type: 1, pattern: 'ABB',
    rule: 'One arrow, then two stars, again and again.',
    cells: [c('arrow'), c('star', 'dots'), c('star', 'dots'), c('arrow'), null],
    choices: [{ id: 'a', ...c('star', 'dots') }, { id: 'b', ...c('arrow') }, { id: 'c', ...c('arrow', 'dots') }],
    correctId: 'a',
  },
  {
    id: 'pp-t1-07', type: 1, pattern: 'ABC',
    rule: 'Circle, triangle, square, then start again.',
    cells: [c('circle'), c('triangle'), c('square'), c('circle'), c('triangle'), null],
    choices: [{ id: 'a', ...c('circle') }, { id: 'b', ...c('triangle') }, { id: 'c', ...c('square') }],
    correctId: 'c',
  },
  {
    id: 'pp-t1-08', type: 1, pattern: 'ABC',
    rule: 'Heart, moon, hexagon, then start again.',
    cells: [c('heart', 'outline'), c('moon', 'stripes'), c('hexagon', 'dots'), c('heart', 'outline'), null],
    choices: [{ id: 'a', ...c('hexagon', 'dots') }, { id: 'b', ...c('moon', 'stripes') }, { id: 'c', ...c('heart', 'outline') }],
    correctId: 'b',
  },
];

// Type 2. Comment: the odd cell breaks EXACTLY ONE property, never two.
// Breaking two makes the item ambiguous (is it odd for its shape or its
// colour?). So the answer matches the grid on every property the grid
// shares except the stated one, and anything the grid does not share (say,
// mixed colours) is borrowed from a colour already in the grid - a new
// colour would be a second difference. The two wrong choices fit in.
//
// The grid is drawn with the gap where the odd one goes; the child picks
// the one of three that does not belong, and the reveal puts it in the gap.
const TYPE2 = [
  {
    id: 'pp-t2-01', type: 2, property: 'shape',
    rule: 'They are all circles, and the square is not.',
    cells: [c('circle'), c('circle', 'stripes'), c('circle', 'dots'), null],
    choices: [{ id: 'a', ...c('circle', 'dots') }, { id: 'b', ...c('square') }, { id: 'c', ...c('circle', 'stripes') }],
    correctId: 'b',
  },
  {
    id: 'pp-t2-02', type: 2, property: 'fill',
    rule: 'They all have blue stripes, and this one has green dots.',
    cells: [c('star', 'stripes'), c('heart', 'stripes'), null, c('moon', 'stripes')],
    choices: [{ id: 'a', ...c('star', 'stripes') }, { id: 'b', ...c('moon', 'stripes') }, { id: 'c', ...c('heart', 'dots') }],
    correctId: 'c',
  },
  {
    id: 'pp-t2-03', type: 2, property: 'size',
    rule: 'They are all big, and this one is small.',
    cells: [c('triangle'), null, c('square'), c('hexagon')],
    choices: [{ id: 'a', ...c('square', 'solid', { size: 'small' }) }, { id: 'b', ...c('triangle') }, { id: 'c', ...c('hexagon') }],
    correctId: 'a',
  },
  {
    id: 'pp-t2-04', type: 2, property: 'turn',
    rule: 'All the arrows point the same way, and this one points down.',
    cells: [c('arrow'), c('arrow', 'stripes'), c('arrow', 'dots'), null],
    choices: [{ id: 'a', ...c('arrow', 'stripes') }, { id: 'b', ...c('arrow', 'dots') }, { id: 'c', ...c('arrow', 'solid', { turn: 90 }) }],
    correctId: 'c',
  },
  {
    id: 'pp-t2-05', type: 2, property: 'shape',
    rule: 'They are all stars, and the moon is not.',
    cells: [
      c('star'), c('star', 'stripes'), c('star', 'dots'),
      c('star', 'outline'), null, c('star'),
      c('star', 'dots'), c('star', 'outline'), c('star', 'stripes'),
    ],
    choices: [{ id: 'a', ...c('star') }, { id: 'b', ...c('star', 'outline') }, { id: 'c', ...c('moon', 'stripes') }],
    correctId: 'c',
  },
  {
    id: 'pp-t2-06', type: 2, property: 'sides',
    rule: 'They all have four sides, and the triangle has three.',
    cells: [
      c('square'), c('diamond'), c('square'),
      c('diamond'), null, c('diamond'),
      c('square'), c('diamond'), c('square'),
    ],
    choices: [{ id: 'a', ...c('diamond') }, { id: 'b', ...c('triangle') }, { id: 'c', ...c('square') }],
    correctId: 'b',
  },
  {
    id: 'pp-t2-07', type: 2, property: 'fill',
    rule: 'They all have green dots, and this one is plain black.',
    cells: [
      c('circle', 'dots'), c('square', 'dots'), c('cross', 'dots'),
      c('square', 'dots'), c('cross', 'dots'), c('circle', 'dots'),
      c('cross', 'dots'), null, c('square', 'dots'),
    ],
    choices: [{ id: 'a', ...c('cross', 'dots') }, { id: 'b', ...c('circle', 'dots') }, { id: 'c', ...c('square') }],
    correctId: 'c',
  },
  {
    id: 'pp-t2-08', type: 2, property: 'size',
    rule: 'They are all small, and this one is big.',
    cells: [
      c('heart', 'solid', { size: 'small' }), c('heart', 'stripes', { size: 'small' }), c('heart', 'outline', { size: 'small' }),
      null, c('heart', 'solid', { size: 'small' }), c('heart', 'stripes', { size: 'small' }),
      c('heart', 'outline', { size: 'small' }), c('heart', 'solid', { size: 'small' }), c('heart', 'stripes', { size: 'small' }),
    ],
    choices: [{ id: 'a', ...c('heart', 'stripes', { size: 'small' }) }, { id: 'b', ...c('heart', 'outline') }, { id: 'c', ...c('heart', 'solid', { size: 'small' }) }],
    correctId: 'b',
  },
];

// Type 3. Comment: exactly one rule per axis, stated in the data as
// `rowRule` (what changes as you go across a row) and `colRule` (what
// changes as you go down a column), so a validator can assert both exist.
// `vary` names the property each rule is about; `down: null` means every
// row is the same. Everything else stays the same in the whole matrix, so
// the gap has exactly one answer. The wrong choices each get one axis right.
const TYPE3 = [
  {
    id: 'pp-t3-01', type: 3, vary: { across: 'shape', down: 'fill' },
    rule: 'Each row keeps its colour, and each column keeps its shape.',
    rowRule: 'Going across, the shape changes from circle to square.',
    colRule: 'Going down, black changes to blue stripes.',
    cells: [c('circle'), c('square'), c('circle', 'stripes'), null],
    choices: [{ id: 'a', ...c('square') }, { id: 'b', ...c('circle', 'stripes') }, { id: 'c', ...c('square', 'stripes') }],
    correctId: 'c',
  },
  {
    id: 'pp-t3-02', type: 3, vary: { across: 'size', down: 'shape' },
    rule: 'Each row keeps its shape, and big always comes before small.',
    rowRule: 'Going across, big changes to small.',
    colRule: 'Going down, the star changes to a heart.',
    cells: [c('star'), c('star', 'solid', { size: 'small' }), c('heart'), null],
    choices: [{ id: 'a', ...c('heart', 'solid', { size: 'small' }) }, { id: 'b', ...c('heart') }, { id: 'c', ...c('star', 'solid', { size: 'small' }) }],
    correctId: 'a',
  },
  {
    id: 'pp-t3-03', type: 3, vary: { across: 'turn', down: 'fill' },
    rule: 'Each row keeps its colour, and the arrows point right, then left.',
    rowRule: 'Going across, the arrow turns from right to left.',
    colRule: 'Going down, black changes to green dots.',
    cells: [c('arrow'), c('arrow', 'solid', { turn: 180 }), c('arrow', 'dots'), null],
    choices: [{ id: 'a', ...c('arrow', 'dots') }, { id: 'b', ...c('arrow', 'dots', { turn: 180 }) }, { id: 'c', ...c('arrow', 'solid', { turn: 180 }) }],
    correctId: 'b',
  },
  {
    id: 'pp-t3-04', type: 3, vary: { across: 'shape', down: 'fill' },
    rule: 'Each row keeps its colour, and each column keeps its shape.',
    rowRule: 'Going across, it goes triangle, circle, square.',
    colRule: 'Going down, it goes black, blue stripes, green dots.',
    cells: [
      c('triangle'), c('circle'), c('square'),
      c('triangle', 'stripes'), c('circle', 'stripes'), c('square', 'stripes'),
      c('triangle', 'dots'), c('circle', 'dots'), null,
    ],
    choices: [{ id: 'a', ...c('square', 'stripes') }, { id: 'b', ...c('square', 'dots') }, { id: 'c', ...c('circle', 'dots') }],
    correctId: 'b',
  },
  {
    id: 'pp-t3-05', type: 3, vary: { across: 'fill', down: 'shape' },
    rule: 'Each row keeps its shape, and each column keeps its colour.',
    rowRule: 'Going across, it goes black, blue stripes, red outline.',
    colRule: 'Going down, it goes hexagon, moon, cross.',
    cells: [
      c('hexagon'), c('hexagon', 'stripes'), c('hexagon', 'outline'),
      c('moon'), null, c('moon', 'outline'),
      c('cross'), c('cross', 'stripes'), c('cross', 'outline'),
    ],
    choices: [{ id: 'a', ...c('moon', 'stripes') }, { id: 'b', ...c('moon') }, { id: 'c', ...c('hexagon', 'stripes') }],
    correctId: 'a',
  },
  {
    id: 'pp-t3-06', type: 3, vary: { across: 'shape', down: null },
    rule: 'Every row is the same: star, diamond, heart.',
    rowRule: 'Going across, it goes star, diamond, heart.',
    colRule: 'Going down, nothing changes.',
    cells: [
      c('star'), c('diamond'), c('heart'),
      c('star'), c('diamond'), c('heart'),
      null, c('diamond'), c('heart'),
    ],
    choices: [{ id: 'a', ...c('diamond') }, { id: 'b', ...c('heart') }, { id: 'c', ...c('star') }],
    correctId: 'c',
  },
  {
    id: 'pp-t3-07', type: 3, vary: { across: 'turn', down: 'fill' },
    rule: 'Each row keeps its colour, and the triangle turns a quarter more each time.',
    rowRule: 'Going across, the triangle points up, then right, then down.',
    colRule: 'Going down, it goes black, blue stripes, green dots.',
    cells: [
      c('triangle'), c('triangle', 'solid', { turn: 90 }), null,
      c('triangle', 'stripes'), c('triangle', 'stripes', { turn: 90 }), c('triangle', 'stripes', { turn: 180 }),
      c('triangle', 'dots'), c('triangle', 'dots', { turn: 90 }), c('triangle', 'dots', { turn: 180 }),
    ],
    choices: [{ id: 'a', ...c('triangle', 'solid', { turn: 90 }) }, { id: 'b', ...c('triangle', 'solid', { turn: 180 }) }, { id: 'c', ...c('triangle', 'stripes', { turn: 180 }) }],
    correctId: 'b',
  },
];

// Type 4. Comment: never use a rule a child cannot verify by counting on
// screen. Every term is a row of one shape (at most 10, the counting
// layout's limit) and every rule is checked by counting boxes:
//   plus1      one more each time            1, 2, 3 -> 4
//   double     twice as many each time       1, 2, 4 -> 8
//   alternate  two numbers take turns        2, 5, 2 -> 5
//   repeat     each number twice, then up    2, 2, 3 -> 3
// 1, 2, 4 could also be read as "add one more than last time" (-> 7), so
// 7 is never offered as a choice there.
const TYPE4 = [
  {
    id: 'pp-t4-01', type: 4, growth: 'plus1',
    rule: 'There is one more star each time.',
    cells: ['star', 'star', 'star', null], counts: [1, 2, 3, null],
    choices: [{ id: 'a', shape: 'star', count: 3 }, { id: 'b', shape: 'star', count: 4 }, { id: 'c', shape: 'star', count: 5 }],
    correctId: 'b',
  },
  {
    id: 'pp-t4-02', type: 4, growth: 'plus1',
    rule: 'There is one more circle each time.',
    cells: ['circle', 'circle', 'circle', null], counts: [3, 4, 5, null],
    choices: [{ id: 'a', shape: 'circle', count: 6 }, { id: 'b', shape: 'circle', count: 5 }, { id: 'c', shape: 'circle', count: 7 }],
    correctId: 'a',
  },
  {
    id: 'pp-t4-03', type: 4, growth: 'double',
    rule: 'There are twice as many hearts each time.',
    cells: ['heart', 'heart', 'heart', null], counts: [1, 2, 4, null],
    choices: [{ id: 'a', shape: 'heart', count: 5 }, { id: 'b', shape: 'heart', count: 6 }, { id: 'c', shape: 'heart', count: 8 }],
    correctId: 'c',
  },
  {
    id: 'pp-t4-04', type: 4, growth: 'alternate',
    rule: 'Two squares, then five, then two, then five: they take turns.',
    cells: ['square', 'square', 'square', null], counts: [2, 5, 2, null],
    choices: [{ id: 'a', shape: 'square', count: 5 }, { id: 'b', shape: 'square', count: 2 }, { id: 'c', shape: 'square', count: 3 }],
    correctId: 'a',
  },
  {
    id: 'pp-t4-05', type: 4, growth: 'repeat',
    rule: 'Each number of triangles comes twice, then one more.',
    cells: ['triangle', 'triangle', 'triangle', null], counts: [2, 2, 3, null],
    choices: [{ id: 'a', shape: 'triangle', count: 4 }, { id: 'b', shape: 'triangle', count: 3 }, { id: 'c', shape: 'triangle', count: 2 }],
    correctId: 'b',
  },
  {
    id: 'pp-t4-06', type: 4, growth: 'alternate',
    rule: 'One moon, then four, then one, then four: they take turns.',
    cells: ['moon', 'moon', 'moon', null], counts: [1, 4, 1, null],
    choices: [{ id: 'a', shape: 'moon', count: 1 }, { id: 'b', shape: 'moon', count: 5 }, { id: 'c', shape: 'moon', count: 4 }],
    correctId: 'c',
  },
  {
    id: 'pp-t4-07', type: 4, growth: 'plus1',
    rule: 'There is one more hexagon each time.',
    cells: ['hexagon', 'hexagon', 'hexagon', null], counts: [5, 6, 7, null],
    choices: [{ id: 'a', shape: 'hexagon', count: 7 }, { id: 'b', shape: 'hexagon', count: 8 }, { id: 'c', shape: 'hexagon', count: 9 }],
    correctId: 'b',
  },
  {
    id: 'pp-t4-08', type: 4, growth: 'repeat',
    rule: 'Each number of diamonds comes twice, then one more.',
    cells: ['diamond', 'diamond', 'diamond', null], counts: [3, 3, 4, null],
    choices: [{ id: 'a', shape: 'diamond', count: 3 }, { id: 'b', shape: 'diamond', count: 5 }, { id: 'c', shape: 'diamond', count: 4 }],
    correctId: 'c',
  },
];

// ------------------------------------------------------------------ rules

// True when `seq` (no gaps) repeats `pattern` from its first cell, with each
// letter a different cell.
export function continuesPattern(seq, pattern) {
  const unit = PATTERNS[pattern];
  if (!unit || !Array.isArray(seq) || seq.length < unit.length || seq.some((x) => x == null)) return false;
  const symbols = [];
  unit.forEach((k, i) => { if (symbols[k] === undefined) symbols[k] = seq[i]; });
  const keys = symbols.map(cellKey);
  if (new Set(keys).size !== keys.length) return false;
  return seq.every((x, i) => cellKey(x) === keys[unit[i % unit.length]]);
}

// The next count after `given` under `growth`, or null if `given` does not
// follow that growth.
export function nextCount(growth, given) {
  if (!Array.isArray(given) || given.length < 3 || !given.every((n) => Number.isInteger(n) && n >= 1)) return null;
  const all = (f) => given.every((n, i) => n === f(i));
  const [a, b] = given;
  const len = given.length;
  if (growth === 'plus1') return all((i) => a + i) ? a + len : null;
  if (growth === 'double') return all((i) => a * 2 ** i) ? a * 2 ** len : null;
  if (growth === 'alternate') return a !== b && all((i) => (i % 2 ? b : a)) ? (len % 2 ? b : a) : null;
  if (growth === 'repeat') return all((i) => a + Math.floor(i / 2)) ? a + Math.floor(len / 2) : null;
  return null;
}

// The grid with the gap filled by `cell`.
export function filled(puzzle, cell) {
  return puzzle.cells.map((x) => (x === null ? cell : x));
}

export const gridSize = (puzzle) => (puzzle.type === 2 || puzzle.type === 3
  ? Math.round(Math.sqrt(puzzle.cells.length))
  : puzzle.cells.length);

export const puzzlesOfType = (type, list = PUZZLES) => list.filter((p) => p.type === type);

// ------------------------------------------------------------------ checks

function fail(id, msg) {
  throw new Error(`pattern-puzzles: ${id}: ${msg}`);
}

function checkCell(id, where, raw) {
  const x = normaliseCell(raw);
  if (!hasShape(x.shape)) fail(id, `${where} uses unknown shape "${x.shape}"`);
  if (!FILLS[x.fill]) fail(id, `${where} uses unknown fill "${x.fill}"`);
  if (!SIZES.includes(x.size)) fail(id, `${where} uses unknown size "${x.size}"`);
  if (!TURNS.includes(x.turn)) fail(id, `${where} uses unknown turn "${x.turn}"`);
  // A turned circle looks unturned: only pointed shapes may turn.
  if (x.turn !== 0 && !SHAPES[x.shape].turns) fail(id, `${where} turns a ${x.shape}, which looks the same turned`);
}

const shared = (cells, prop) => {
  const vals = new Set(cells.map((x) => propertyOf(x, prop)));
  return vals.size === 1 ? [...vals][0] : undefined;
};

function checkSequence(p) {
  const n = p.cells.length;
  if (n < 4 || n > 6) fail(p.id, `type 1 needs a row of 4-6 cells, has ${n}`);
  if (p.cells[n - 1] !== null) fail(p.id, 'type 1 must be missing its last cell');
  if (!PATTERNS[p.pattern]) fail(p.id, `unknown pattern "${p.pattern}" (use ${Object.keys(PATTERNS).join(', ')})`);
  const correct = p.choices.find((ch) => ch.id === p.correctId);
  if (!continuesPattern(filled(p, correct), p.pattern)) fail(p.id, `the answer does not continue ${p.pattern}`);
  const given = p.cells.filter(Boolean).map(normaliseCell);
  if (!continuesPattern(given, p.pattern)) fail(p.id, `the row does not show ${p.pattern} clearly`);
  for (const ch of p.choices) {
    if (ch.id === p.correctId) continue;
    const x = normaliseCell(ch);
    // Plausible, not noise: made only of what is already in the row.
    if (!given.some((g) => g.shape === x.shape)) fail(p.id, `distractor ${ch.id} (${x.shape}) is not in the row`);
    if (!given.some((g) => g.fill === x.fill)) fail(p.id, `distractor ${ch.id} fill "${x.fill}" is not in the row`);
    if (continuesPattern(filled(p, ch), p.pattern)) fail(p.id, `distractor ${ch.id} also continues the pattern`);
  }
}

function checkOddOneOut(p) {
  const n = p.cells.length;
  if (n !== 4 && n !== 9) fail(p.id, `type 2 needs a 2x2 or 3x3 grid, has ${n} cells`);
  const prop = p.property;
  if (!['shape', 'fill', 'size', 'turn', 'sides'].includes(prop)) fail(p.id, `unknown property "${prop}"`);
  const given = p.cells.filter(Boolean);
  const shares = shared(given, prop);
  if (shares === undefined || shares === null) fail(p.id, `the grid does not all share the same ${prop}`);
  // Sides comes from the shape: a sides puzzle needs mixed shapes (else it
  // is a shape puzzle) and its shape change is the sides change.
  if (prop === 'sides' && shared(given, 'shape') !== undefined) fail(p.id, 'a sides puzzle needs more than one shape');
  const sharedBase = BASE_PROPS.filter((q) => q !== prop && shared(given, q) !== undefined && !(prop === 'sides' && q === 'shape'));
  const looseBase = BASE_PROPS.filter((q) => q !== prop && !sharedBase.includes(q) && !(prop === 'sides' && q === 'shape'));

  for (const ch of p.choices) {
    const right = ch.id === p.correctId;
    const value = propertyOf(ch, prop);
    if (right && (value === shares || value === null)) fail(p.id, `the answer does not break "${prop}"`);
    if (!right && value !== shares) fail(p.id, `distractor ${ch.id} breaks "${prop}" too`);
    // Exactly one property broken: equal on everything else the grid shares...
    for (const q of sharedBase) {
      if (propertyOf(ch, q) !== shared(given, q)) {
        fail(p.id, right
          ? `the answer breaks two properties ("${prop}" and "${q}")`
          : `distractor ${ch.id} breaks "${q}"`);
      }
    }
    // ...and nothing new where the grid is mixed.
    for (const q of looseBase) {
      if (!given.some((g) => propertyOf(g, q) === propertyOf(ch, q))) fail(p.id, `choice ${ch.id} brings a new ${q} the grid does not have`);
    }
    if (prop === 'sides' && !right && !given.some((g) => normaliseCell(g).shape === normaliseCell(ch).shape)) {
      fail(p.id, `distractor ${ch.id} brings a new shape`);
    }
  }
}

// across: the property that changes along a row; down: along a column (or
// null). Cell (r, k): `across` depends only on k, `down` only on r, the rest
// is the same everywhere.
export function matrixHolds(cells, size, vary) {
  const at = (r, k) => cells[r * size + k];
  const rest = BASE_PROPS.filter((q) => q !== vary.across && q !== vary.down);
  for (const q of rest) if (shared(cells, q) === undefined) return false;
  for (let k = 0; k < size; k++) {
    if (shared(Array.from({ length: size }, (_, r) => at(r, k)), vary.across) === undefined) return false;
  }
  if (new Set(Array.from({ length: size }, (_, k) => propertyOf(at(0, k), vary.across))).size !== size) return false;
  if (vary.down) {
    for (let r = 0; r < size; r++) {
      if (shared(Array.from({ length: size }, (_, k) => at(r, k)), vary.down) === undefined) return false;
    }
    if (new Set(Array.from({ length: size }, (_, r) => propertyOf(at(r, 0), vary.down))).size !== size) return false;
  }
  return true;
}

function checkMatrix(p) {
  const n = p.cells.length;
  if (n !== 4 && n !== 9) fail(p.id, `type 3 needs a 2x2 or 3x3 matrix, has ${n} cells`);
  if (typeof p.rowRule !== 'string' || !p.rowRule.trim()) fail(p.id, 'type 3 needs a rowRule');
  if (typeof p.colRule !== 'string' || !p.colRule.trim()) fail(p.id, 'type 3 needs a colRule');
  const v = p.vary || {};
  if (!BASE_PROPS.includes(v.across)) fail(p.id, `vary.across must be one of ${BASE_PROPS.join(', ')}`);
  if (v.down !== null && (!BASE_PROPS.includes(v.down) || v.down === v.across)) fail(p.id, 'vary.down must be a different property or null');
  const size = gridSize(p);
  const correct = p.choices.find((ch) => ch.id === p.correctId);
  if (!matrixHolds(filled(p, normaliseCell(correct)), size, v)) fail(p.id, 'the answer does not complete the matrix');
  for (const ch of p.choices) {
    if (ch.id !== p.correctId && matrixHolds(filled(p, normaliseCell(ch)), size, v)) fail(p.id, `distractor ${ch.id} also completes the matrix`);
  }
}

function checkGrowing(p) {
  if (!Array.isArray(p.counts) || p.counts.length !== 4) fail(p.id, 'type 4 needs counts of 4 terms');
  if (p.counts[3] !== null || p.counts.slice(0, 3).some((x) => x === null)) fail(p.id, 'type 4 counts must be three numbers then null');
  if (p.cells.length !== 4 || p.cells[3] !== null) fail(p.id, 'type 4 cells must be three shapes then null');
  const shape = shared(p.cells.slice(0, 3), 'shape');
  if (shape === undefined) fail(p.id, 'type 4 counts one shape only');
  if (!GROWTHS.includes(p.growth)) fail(p.id, `unknown growth "${p.growth}" (use ${GROWTHS.join(', ')})`);
  const given = p.counts.slice(0, 3);
  if (given.some((x) => !Number.isInteger(x) || x < 1 || x > MAX_COUNT)) fail(p.id, `counts must be whole numbers 1-${MAX_COUNT}`);
  const next = nextCount(p.growth, given);
  if (next === null) fail(p.id, `counts ${given.join(', ')} do not grow by "${p.growth}"`);
  if (next > MAX_COUNT) fail(p.id, `the next count ${next} is more than fits on screen`);
  for (const ch of p.choices) {
    if (!Number.isInteger(ch.count) || ch.count < 1 || ch.count > MAX_COUNT) fail(p.id, `choice ${ch.id} needs a count 1-${MAX_COUNT}`);
    if (normaliseCell(ch).shape !== shape) fail(p.id, `choice ${ch.id} must be ${shape}s`);
    if ((ch.id === p.correctId) !== (ch.count === next)) {
      fail(p.id, ch.id === p.correctId ? `the answer is ${ch.count} but the next count is ${next}` : `distractor ${ch.id} is also ${next}`);
    }
  }
}

export function validatePuzzle(p) {
  const id = p && typeof p.id === 'string' && p.id ? p.id : '(no id)';
  if (!p || typeof p !== 'object') fail(id, 'is not an object');
  if (!/^pp-t[1-4]-\d{2}$/.test(id)) fail(id, 'id must look like pp-t1-01');
  if (!TASK_TYPES.includes(p.type)) fail(id, `type must be 1, 2, 3 or 4, got ${p.type}`);
  if (Number(id[4]) !== p.type) fail(id, `id says type ${id[4]} but type is ${p.type}`);
  if (typeof p.rule !== 'string' || !p.rule.trim()) fail(id, 'rule is empty');

  if (!Array.isArray(p.cells)) fail(id, 'cells must be an array');
  const gaps = p.cells.filter((x) => x === null).length;
  if (gaps > 1) fail(id, `has ${gaps} null cells; exactly one cell may be missing`);
  if (gaps === 0) fail(id, 'has no null cell; one cell must be missing');
  p.cells.forEach((x, i) => { if (x !== null) checkCell(id, `cells[${i}]`, x); });

  if (!Array.isArray(p.choices) || p.choices.length !== CHOICE_COUNT) {
    fail(id, `needs exactly ${CHOICE_COUNT} choices, has ${Array.isArray(p.choices) ? p.choices.length : 'none'}`);
  }
  const ids = p.choices.map((ch) => ch && ch.id);
  if (ids.some((x) => typeof x !== 'string' || !x) || new Set(ids).size !== ids.length) fail(id, 'choice ids must be unique strings');
  p.choices.forEach((ch) => checkCell(id, `choice ${ch.id}`, ch));
  if (!ids.includes(p.correctId)) fail(id, `correctId "${p.correctId}" is not among the choices (${ids.join(', ')})`);
  const looks = p.choices.map((ch) => `${cellKey(ch)}#${ch.count ?? ''}`);
  if (new Set(looks).size !== looks.length) fail(id, 'two choices look the same');

  if (p.type === 1) checkSequence(p);
  if (p.type === 2) checkOddOneOut(p);
  if (p.type === 3) checkMatrix(p);
  if (p.type === 4) checkGrowing(p);
  return p;
}

export function validatePuzzles(list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('pattern-puzzles: no puzzles');
  const seen = new Set();
  for (const p of list) {
    validatePuzzle(p);
    if (seen.has(p.id)) fail(p.id, 'duplicate id');
    seen.add(p.id);
  }
  return list;
}

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.values(x).forEach(deepFreeze);
    Object.freeze(x);
  }
  return x;
}

export const PUZZLES = deepFreeze(validatePuzzles([...TYPE1, ...TYPE2, ...TYPE3, ...TYPE4]));