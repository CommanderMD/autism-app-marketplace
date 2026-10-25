// Pattern Puzzles shape vocabulary: shape key -> outline, plus the four
// visible properties a cell can have (fill, size, turn, and sides, which
// comes from the shape).
//
// Drawing follows act1/engine/svg.js: a self-contained
// <svg viewBox="0 0 100 100" aria-hidden="true">, currentColor ink with a
// 2px stroke, no <script>, no <image>, no <text>, no href, no "http". The
// accessible name is the cell's or choice's label, never the picture.
//
// Every shape is told apart by its silhouette alone - the comment above each
// says how - so a puzzle still works in greyscale, in high contrast, and for
// a child who does not see colour. All outlines are drawn for this project
// from straight lines and arcs; nothing is copied from an icon set.

export const SHAPES = Object.freeze({
  // The only outline with no corners and no flat edge: a smooth round rim.
  circle: Object.freeze({ path: 'M12 50 A38 38 0 1 0 88 50 A38 38 0 1 0 12 50 Z', sides: 0, curved: true, turns: false }),
  // Four equal straight sides meeting in right angles; as wide as it is tall.
  square: Object.freeze({ path: 'M14 14 H86 V86 H14 Z', sides: 4, curved: false, turns: false }),
  // Three straight sides: one point at the top, a flat base.
  triangle: Object.freeze({ path: 'M50 10 L90 86 H10 Z', sides: 3, curved: false, turns: true }),
  // Five sharp points around a hollow middle: ten short sides.
  star: Object.freeze({ path: 'M50 11 L60 39.2 L89.9 40 L66.2 58.3 L74.7 87 L50 70 L25.3 87 L33.8 58.3 L10.1 40 L40 39.2 Z', sides: 10, curved: false, turns: false }),
  // Two round bumps on top with a dip between them, one point at the bottom.
  heart: Object.freeze({ path: 'M50 86 C20 64 8 46 14 30 C20 14 42 12 50 30 C58 12 80 14 86 30 C92 46 80 64 50 86 Z', sides: 0, curved: true, turns: false }),
  // Four straight sides standing on a point; much taller than it is wide,
  // so it never reads as a square turned on its corner.
  diamond: Object.freeze({ path: 'M50 6 L80 50 L50 94 L20 50 Z', sides: 4, curved: false, turns: false }),
  // Six equal straight sides; flat top and bottom, points left and right.
  hexagon: Object.freeze({ path: 'M90 50 L70 84.6 H30 L10 50 L30 15.4 H70 Z', sides: 6, curved: false, turns: false }),
  // A plus sign: four thick arms of equal length, twelve straight sides.
  cross: Object.freeze({ path: 'M37 10 H63 V37 H90 V63 H63 V90 H37 V63 H10 V37 H37 Z', sides: 12, curved: false, turns: false }),
  // A thick curved crescent with two sharp tips, open on the right.
  moon: Object.freeze({ path: 'M62 11.84 A40 40 0 1 0 62 88.16 A42 42 0 0 1 62 11.84 Z', sides: 0, curved: true, turns: false }),
  // A straight shaft with a wide pointed head; seven sides, points right.
  arrow: Object.freeze({ path: 'M10 38 H56 V18 L92 50 L56 82 V62 H10 Z', sides: 7, curved: false, turns: true }),
});

export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));
export const hasShape = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, key);

// Sides only means something for straight-edged shapes. Curved outlines
// (circle, heart, moon) have no count of sides and are never used in a
// "same number of sides" puzzle.
export const sidesOf = (key) => (hasShape(key) && !SHAPES[key].curved ? SHAPES[key].sides : null);

// Fills: each is a colour AND a pattern, so "same colour" is also "same
// pattern" and is never carried by colour alone. Colours are the Act 1
// palette; each passes 4.5:1 on #ffffff (act1/engine/svg.js lists the
// ratios). In high contrast the shell turns every colour to black and the
// pattern still tells them apart.
export const FILLS = Object.freeze({
  solid: Object.freeze({ color: '#14181f' }),   // black, filled in
  stripes: Object.freeze({ color: '#1d4ed8' }), // blue, diagonal stripes
  dots: Object.freeze({ color: '#15803d' }),    // green, dotted
  outline: Object.freeze({ color: '#c62828' }), // red, edge only, empty inside
});
export const FILL_KEYS = Object.freeze(Object.keys(FILLS));
export const SIZES = Object.freeze(['big', 'small']);
// Quarter turns, clockwise. Only shapes with a single point (triangle,
// arrow) are ever turned: a turned circle, square or star looks the same, so
// a turn would be invisible and the puzzle unfair.
export const TURNS = Object.freeze([0, 90, 180, 270]);

// Every property a puzzle may compare, in the order labels read them.
export const PROPERTIES = Object.freeze(['shape', 'fill', 'size', 'turn', 'sides']);

// A cell in puzzle data is a shape key or { shape, fill?, size?, turn? }.
export function normaliseCell(cell) {
  if (cell === null || cell === undefined) return null;
  const c = typeof cell === 'string' ? { shape: cell } : cell;
  return {
    shape: c.shape,
    fill: c.fill === undefined ? 'solid' : c.fill,
    size: c.size === undefined ? 'big' : c.size,
    turn: c.turn === undefined ? 0 : c.turn,
  };
}

export function propertyOf(cell, prop) {
  const c = normaliseCell(cell);
  if (!c) return undefined;
  return prop === 'sides' ? sidesOf(c.shape) : c[prop];
}

export const cellKey = (cell) => {
  const c = normaliseCell(cell);
  return c ? `${c.shape}|${c.fill}|${c.size}|${c.turn}` : 'null';
};
export const sameCell = (a, b) => cellKey(a) === cellKey(b);

// ---------------------------------------------------------------- drawing

const wrap = (color, body) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" color="${color}">${body}</svg>`;

// Pattern ids must be unique in the page, so the shell passes a uid.
function paint(fill, uid) {
  if (fill === 'stripes') {
    const id = `pp-st-${uid}`;
    return {
      defs: `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect x="0" y="0" width="5" height="10" fill="currentColor"/></pattern></defs>`,
      fill: `url(#${id})`,
    };
  }
  if (fill === 'dots') {
    const id = `pp-dt-${uid}`;
    return {
      defs: `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="5" cy="5" r="2.6" fill="currentColor"/></pattern></defs>`,
      fill: `url(#${id})`,
    };
  }
  return { defs: '', fill: fill === 'outline' ? 'none' : 'currentColor' };
}

// The 2px ink line stays 2px at any size: vector-effect keeps it from
// shrinking with the small size or the counting layout.
const outline = (shape, fill) =>
  `<path d="${SHAPES[shape].path}" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;

function placed(c, fill, transform = '') {
  const parts = [transform];
  if (c.turn) parts.push(`rotate(${c.turn} 50 50)`);
  if (c.size === 'small') parts.push('translate(50 50) scale(0.56) translate(-50 -50)');
  const t = parts.filter(Boolean).join(' ');
  return t ? `<g transform="${t}">${outline(c.shape, fill)}</g>` : outline(c.shape, fill);
}

// One shape in a 100x100 box. Unknown keys draw nothing.
export function shapeSvg(cell, uid = '0') {
  const c = normaliseCell(cell);
  if (!c || !hasShape(c.shape) || !FILLS[c.fill]) return '';
  const p = paint(c.fill, uid);
  return wrap(FILLS[c.fill].color, `${p.defs}${placed(c, p.fill)}`);
}

// `count` copies of one shape for growing patterns: up to five in a row, a
// second row for 6-10. The same count always has the same layout, so a
// number always looks the same and can be counted one by one.
export const MAX_COUNT = 10;
export function countSvg(cell, count, uid = '0') {
  const c = normaliseCell(cell);
  const n = Math.trunc(count);
  if (!c || !hasShape(c.shape) || !FILLS[c.fill] || !(n >= 1 && n <= MAX_COUNT)) return '';
  const p = paint(c.fill, uid);
  const rows = n <= 5 ? [n] : [5, n - 5];
  const ys = rows.length === 1 ? [50] : [32, 68];
  let body = '';
  rows.forEach((k, r) => {
    for (let i = 0; i < k; i++) {
      const x = 50 + (i - (k - 1) / 2) * 19;
      body += placed({ ...c, size: 'big' }, p.fill, `translate(${x} ${ys[r]}) scale(0.16) translate(-50 -50)`);
    }
  });
  return wrap(FILLS[c.fill].color, `${p.defs}${body}`);
}
