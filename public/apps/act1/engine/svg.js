// Act 1 inline SVG library: name -> SVG markup string.
//
// Every picture any lesson uses lives here, and lessons refer to them by key
// only (choice.svg), never by inline markup or file. All artwork below is
// drawn for this project from geometric primitives; nothing is copied from an
// icon set, so there is no third-party licence to track.
//
// Rules each entry follows (test/phase4-engine.test.js enforces the safety ones):
// - self-contained <svg viewBox="0 0 100 100" role="img" aria-hidden="true">;
//   the accessible name is the choice's text label, not the picture
// - no <script>, no <image>, no external href, no event attributes, no "http"
//   anywhere. That includes xmlns: entries are inserted inline into HTML,
//   where the SVG namespace is implied, so they are not standalone .svg files
// - fill/stroke is currentColor, so the picture follows the shell's text
//   colour and its high-contrast mode, or an explicit colour from PALETTE
//
// Colours (05-colors). Assumed app background #ffffff, text #14181f.
// Contrast against #ffffff, computed by the "colour swatch contrast" test:
//   red #c62828 5.62:1, blue #1d4ed8 6.70:1, green #15803d 5.02:1,
//   orange #c2410c 5.18:1, purple #7e22ce 6.98:1 - each passes 4.5:1 alone.
//   yellow #facc15 is 1.53:1 and cannot pass on white at any useful hue, so
//   every swatch (yellow included) is (a) always shown with its text label -
//   the lesson contract requires choice.label - and (b) outlined in #14181f,
//   which is 11.62:1 against yellow. Colour is never the only cue.

const INK = '#14181f';

export const PALETTE = Object.freeze({
  red: '#c62828',
  blue: '#1d4ed8',
  yellow: '#facc15',
  green: '#15803d',
  orange: '#c2410c',
  purple: '#7e22ce',
});

const wrap = (body) =>
  `<svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">${body}</svg>`;

// Line art: round caps, thick enough to read at 44px.
const line = (d, w = 6) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const head = (cx, cy, r = 9) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
const ground = line('M10 94 H90', 4);

const numeral = (n) =>
  `<text x="50" y="${n === 10 ? 70 : 74}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="${n === 10 ? 56 : 68}" fill="currentColor">${n}</text>`;

// Counters: up to five in a row, a second row for 6-10. Always the same
// layout for the same number, so a quantity always looks the same.
function dots(n) {
  const rows = n <= 5 ? [n] : [5, n - 5];
  const ys = rows.length === 1 ? [50] : [34, 66];
  let out = '';
  rows.forEach((k, r) => {
    for (let i = 0; i < k; i++) {
      const x = 50 + (i - (k - 1) / 2) * 18;
      out += `<circle cx="${x}" cy="${ys[r]}" r="7" fill="currentColor"/>`;
    }
  });
  return out;
}

const swatch = (hex) =>
  `<rect x="8" y="8" width="84" height="84" rx="12" fill="${hex}" stroke="${INK}" stroke-width="4"/>`;

// Faces share one outline and differ only in eyes, brows and mouth.
const face = (features) =>
  `<circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="5"/>${features}`;
const eyes = `<circle cx="36" cy="42" r="5" fill="currentColor"/><circle cx="64" cy="42" r="5" fill="currentColor"/>`;

const ball = (cx, cy, r = 13) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE.blue}" stroke="${INK}" stroke-width="3"/>`;
const box = (x = 34, y = 50, w = 40, h = 38) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#8a5a2b" stroke="${INK}" stroke-width="3"/>`;
const table = `<rect x="20" y="44" width="60" height="7" fill="currentColor"/>${line('M26 51 V92 M74 51 V92', 5)}`;

const shirt = (fill) =>
  `<path d="M30 20 L44 16 Q50 24 56 16 L70 20 L88 36 L78 46 L70 40 V82 H30 V40 L22 46 L12 36 Z" fill="${fill}" stroke="${INK}" stroke-width="3"/>`;
const drop = (x, y) => `<path d="M${x} ${y} Q${x + 6} ${y + 10} ${x} ${y + 14} Q${x - 6} ${y + 10} ${x} ${y} Z" fill="${PALETTE.blue}"/>`;
const block = (y) => `<rect x="32" y="${y}" width="36" height="22" fill="${PALETTE.orange}" stroke="${INK}" stroke-width="3"/>`;
const plate = `<ellipse cx="50" cy="62" rx="40" ry="16" fill="#ffffff" stroke="${INK}" stroke-width="4"/>`;
const bread = (y) => `<rect x="18" y="${y}" width="64" height="12" rx="5" fill="#d9a35b" stroke="${INK}" stroke-width="3"/>`;

const ENTRIES = {
  // --- 01 shapes
  circle: `<circle cx="50" cy="50" r="40" fill="currentColor"/>`,
  square: `<rect x="12" y="12" width="76" height="76" fill="currentColor"/>`,
  triangle: `<polygon points="50,10 92,88 8,88" fill="currentColor"/>`,
  rectangle: `<rect x="6" y="28" width="88" height="44" fill="currentColor"/>`,
  star: `<polygon points="50,11 60,39.2 89.9,40 66.2,58.3 74.7,87 50,70 25.3,87 33.8,58.3 10.1,40 40,39.2" fill="currentColor"/>`,

  // --- 03 nouns (apple and star double as drag items)
  cup: `<path d="M20 28 H70 V68 Q70 84 54 84 H36 Q20 84 20 68 Z" fill="currentColor"/>${line('M70 38 Q88 38 88 54 Q88 68 70 68', 7)}`,
  shoe: `<path d="M8 74 V38 H38 Q44 56 64 58 L84 62 Q94 64 94 74 V80 H8 Z" fill="currentColor"/>`,
  ball: `<circle cx="50" cy="50" r="38" fill="${PALETTE.blue}" stroke="${INK}" stroke-width="4"/><path d="M14 50 H86 M50 12 Q30 50 50 88 M50 12 Q70 50 50 88" fill="none" stroke="#ffffff" stroke-width="4"/>`,
  dog: `<ellipse cx="46" cy="58" rx="28" ry="15" fill="currentColor"/><circle cx="76" cy="38" r="13" fill="currentColor"/><path d="M70 28 L66 14 L80 26 Z" fill="currentColor"/>${line('M28 70 V88 M40 70 V88 M54 70 V88 M64 68 V88', 6)}${line('M18 52 Q8 44 10 32', 5)}`,
  apple: `<path d="M50 30 C20 16 4 50 20 76 C30 92 44 88 50 84 C56 88 70 92 80 76 C96 50 80 16 50 30 Z" fill="${PALETTE.red}" stroke="${INK}" stroke-width="3"/><path d="M50 30 Q50 18 56 10" fill="none" stroke="#5b3a1a" stroke-width="5" stroke-linecap="round"/><path d="M54 20 Q68 6 78 14 Q68 26 54 20 Z" fill="${PALETTE.green}"/>`,
  bed: `<rect x="8" y="30" width="10" height="60" fill="currentColor"/><rect x="18" y="56" width="74" height="16" fill="currentColor"/><rect x="22" y="44" width="22" height="12" rx="5" fill="currentColor"/>${line('M88 72 V90', 6)}`,
  spoon: `<ellipse cx="50" cy="26" rx="16" ry="20" fill="currentColor"/><rect x="45" y="40" width="10" height="54" rx="5" fill="currentColor"/>`,
  book: `<path d="M50 24 Q30 14 8 20 V82 Q30 76 50 86 Q70 76 92 82 V20 Q70 14 50 24 Z" fill="currentColor"/>${line('M50 26 V84', 3).replace('currentColor', '#ffffff')}`,

  // --- 04 verbs (stick figures)
  run: head(58, 16) + line('M56 26 L46 56 M52 36 L34 30 M52 36 L70 48 M46 56 L28 70 L20 66 M46 56 L62 74 L58 92'),
  jump: head(50, 14) + line('M50 24 V54 M50 32 L32 16 M50 32 L68 16 M50 54 L36 72 M50 54 L64 72') + ground,
  eat: head(40, 20) + line('M40 30 V64 M40 64 L30 92 M40 64 L50 92 M40 40 L58 42 L50 26') + `<circle cx="56" cy="22" r="6" fill="${PALETTE.red}"/>`,
  sleep: `<rect x="10" y="66" width="80" height="10" fill="currentColor"/>${line('M14 76 V90 M86 76 V90', 5)}` + head(24, 56, 8) + line('M34 58 H80', 6) + `<text x="56" y="38" font-family="system-ui, sans-serif" font-weight="700" font-size="22" fill="currentColor">Z z</text>`,
  drink: head(40, 20) + line('M40 30 V64 M40 64 L30 92 M40 64 L50 92 M40 40 L58 42 L54 28') + `<rect x="50" y="16" width="12" height="16" fill="${PALETTE.blue}" stroke="${INK}" stroke-width="2"/>`,
  wash: head(28, 18) + line('M28 28 V62 M28 62 L18 92 M28 62 L38 92 M28 38 L54 50') + `<rect x="50" y="58" width="42" height="12" fill="currentColor"/>${line('M74 58 V36 H62', 5)}${drop(62, 40)}`,
  open: head(30, 18) + line('M30 28 V62 M30 62 L20 92 M30 62 L40 92 M30 38 L54 46') + `<rect x="56" y="14" width="34" height="78" fill="none" stroke="currentColor" stroke-width="4"/><path d="M56 14 L76 22 V84 L56 92 Z" fill="currentColor"/>`,
  sit: head(36, 18) + line('M36 28 V58 H62 V90 M36 38 L54 48') + line('M30 58 H74 M30 58 V92 M74 58 V92 M30 58 V30', 4),

  // --- 06 emotions
  happy: face(eyes + line('M30 60 Q50 80 70 60', 5)),
  sad: face(eyes + line('M30 74 Q50 56 70 74', 5)),
  angry: face(eyes + line('M26 30 L44 38 M74 30 L56 38 M34 70 Q50 60 66 70', 5)),
  tired: face(line('M28 44 Q36 50 44 44 M56 44 Q64 50 72 44 M38 68 H62', 5)),
  scared: face(`<circle cx="36" cy="42" r="8" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="64" cy="42" r="8" fill="none" stroke="currentColor" stroke-width="4"/>` + line('M30 70 Q36 64 42 70 Q48 76 54 70 Q60 64 66 70 M28 26 L42 22 M72 26 L58 22', 4)),
  surprised: face(`<circle cx="36" cy="42" r="7" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="64" cy="42" r="7" fill="none" stroke="currentColor" stroke-width="4"/><ellipse cx="50" cy="70" rx="9" ry="11" fill="none" stroke="currentColor" stroke-width="5"/>` + line('M28 24 Q36 18 44 24 M56 24 Q64 18 72 24', 4)),

  // --- 07 opposites (same object, different property, wherever possible)
  big: `<circle cx="50" cy="50" r="44" fill="currentColor"/>`,
  small: `<circle cx="50" cy="50" r="14" fill="currentColor"/>`,
  hot: `<path d="M50 8 C62 30 80 40 80 62 C80 80 66 92 50 92 C34 92 20 80 20 62 C20 46 32 40 36 26 C42 36 46 40 50 8 Z" fill="${PALETTE.orange}" stroke="${INK}" stroke-width="3"/>`,
  cold: line('M50 10 V90 M15 30 L85 70 M15 70 L85 30 M40 14 L50 24 L60 14 M40 86 L50 76 L60 86', 6).replace('currentColor', PALETTE.blue),
  up: `<polygon points="50,8 88,50 64,50 64,92 36,92 36,50 12,50" fill="currentColor"/>`,
  down: `<polygon points="50,92 88,50 64,50 64,8 36,8 36,50 12,50" fill="currentColor"/>`,
  day: `<circle cx="50" cy="50" r="22" fill="${PALETTE.yellow}" stroke="${INK}" stroke-width="3"/>${line('M50 8 V20 M50 80 V92 M8 50 H20 M80 50 H92 M20 20 L28 28 M72 72 L80 80 M80 20 L72 28 M20 80 L28 72', 5)}`,
  night: `<rect x="4" y="4" width="92" height="92" rx="10" fill="#1e293b"/><path d="M60 18 A32 32 0 1 0 82 66 A26 26 0 1 1 60 18 Z" fill="#f8fafc"/><circle cx="28" cy="28" r="3" fill="#f8fafc"/><circle cx="22" cy="60" r="3" fill="#f8fafc"/>`,
  wet: shirt('#93c5fd') + drop(36, 84) + drop(50, 86) + drop(64, 84),
  dry: shirt('#e5e7eb'),
  fast: `<rect x="34" y="44" width="58" height="22" rx="6" fill="${PALETTE.red}" stroke="${INK}" stroke-width="3"/><path d="M46 44 L54 32 H76 L84 44 Z" fill="${PALETTE.red}" stroke="${INK}" stroke-width="3"/><circle cx="48" cy="68" r="8" fill="${INK}"/><circle cx="80" cy="68" r="8" fill="${INK}"/>${line('M6 46 H26 M10 56 H28 M6 66 H24', 4)}`,
  slow: `<circle cx="58" cy="56" r="24" fill="#d9a35b" stroke="${INK}" stroke-width="3"/>${line('M58 44 A12 12 0 1 1 46 56 A6 6 0 1 1 58 50', 3)}<path d="M10 80 H84 Q90 80 88 74 L82 74 H20 Q16 60 12 64 Z" fill="${PALETTE.green}" stroke="${INK}" stroke-width="3"/>${line('M16 62 L10 50 M20 62 L22 50', 3)}`,

  // --- 08 sequencing (routine steps)
  'wash-water': `<rect x="24" y="14" width="40" height="10" fill="currentColor"/><rect x="54" y="14" width="10" height="24" fill="currentColor"/>${drop(59, 46)}${drop(59, 66)}${line('M20 88 H80', 5)}`,
  'wash-soap': `<rect x="20" y="50" width="60" height="32" rx="12" fill="#f9a8d4" stroke="${INK}" stroke-width="3"/><circle cx="34" cy="34" r="9" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="56" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="72" cy="38" r="5" fill="none" stroke="currentColor" stroke-width="3"/>`,
  'wash-towel': `${line('M14 16 H86', 5)}<rect x="24" y="16" width="52" height="72" fill="${PALETTE.green}" stroke="${INK}" stroke-width="3"/>${line('M24 74 H76', 3)}`,
  pajamas: shirt('#c4b5fd') + `<path d="M58 54 A8 8 0 1 0 64 66 A6 6 0 1 1 58 54 Z" fill="${INK}"/>`,
  clothes: `<path d="M30 8 L42 6 Q50 12 58 6 L70 8 L84 20 L76 28 L70 24 V48 H30 V24 L24 28 L16 20 Z" fill="${PALETTE.red}" stroke="${INK}" stroke-width="3"/><path d="M32 52 H68 L72 94 H54 L50 66 L46 94 H28 Z" fill="${PALETTE.blue}" stroke="${INK}" stroke-width="3"/>`,
  table: table + `<rect x="34" y="30" width="32" height="14" rx="3" fill="${PALETTE.orange}"/>`,
  'plate-food': plate + `<circle cx="38" cy="56" r="9" fill="${PALETTE.green}"/><circle cx="58" cy="56" r="10" fill="${PALETTE.orange}"/>`,
  'plate-empty': plate,
  toothpaste: `<path d="M10 40 H66 L80 46 V54 L66 60 H10 Z" fill="#f8fafc" stroke="${INK}" stroke-width="3"/><rect x="80" y="44" width="10" height="12" fill="${PALETTE.blue}"/>`,
  toothbrush: `<rect x="8" y="58" width="70" height="10" rx="5" fill="${PALETTE.blue}" stroke="${INK}" stroke-width="2"/><rect x="60" y="40" width="26" height="18" fill="#f8fafc" stroke="${INK}" stroke-width="3"/>${line('M66 40 V58 M72 40 V58 M78 40 V58', 2)}`,
  bath: `<path d="M10 46 H90 V60 Q90 82 68 82 H32 Q10 82 10 60 Z" fill="#f8fafc" stroke="${INK}" stroke-width="4"/><rect x="14" y="50" width="72" height="8" fill="#93c5fd"/>${line('M24 82 L20 92 M76 82 L80 92 M16 46 V18 H30', 5)}`,
  seed: `<rect x="6" y="56" width="88" height="38" fill="#8a5a2b"/><ellipse cx="50" cy="70" rx="7" ry="5" fill="#f5deb3" stroke="${INK}" stroke-width="2"/>`,
  'watering-can': `<path d="M24 40 H66 V82 H24 Z" fill="${PALETTE.green}" stroke="${INK}" stroke-width="3"/>${line('M66 52 L88 34 M24 48 Q8 56 24 70', 5)}${drop(90, 44)}`,
  flower: `<rect x="6" y="78" width="88" height="16" fill="#8a5a2b"/>${line('M50 78 V44', 5).replace('currentColor', PALETTE.green)}<circle cx="50" cy="20" r="10" fill="${PALETTE.red}"/><circle cx="38" cy="32" r="10" fill="${PALETTE.red}"/><circle cx="62" cy="32" r="10" fill="${PALETTE.red}"/><circle cx="50" cy="44" r="10" fill="${PALETTE.red}"/><circle cx="50" cy="32" r="8" fill="${PALETTE.yellow}"/>`,
  bread: bread(50),
  filling: bread(56) + `<rect x="16" y="48" width="68" height="8" rx="3" fill="${PALETTE.yellow}" stroke="${INK}" stroke-width="2"/>`,
  sandwich: bread(60) + `<rect x="16" y="52" width="68" height="8" rx="3" fill="${PALETTE.yellow}" stroke="${INK}" stroke-width="2"/>` + bread(40),
  'blocks-1': block(70) + ground,
  'blocks-2': block(48) + block(70) + ground,
  'blocks-3': block(26) + block(48) + block(70) + ground,

  // --- 09 prepositions. The ball is always the same blue ball; for "under"
  // the reference object has to be a table, so those steps compare tables.
  'ball-in-box': ball(54, 52) + box(),
  'ball-on-box': box() + ball(54, 36),
  'ball-next-to-box': box(22, 50) + ball(80, 75),
  'ball-behind-box': ball(66, 44) + box(),
  'ball-in-front-of-box': box(34, 40) + ball(54, 80),
  'ball-under-table': table + ball(50, 78),
  'ball-on-table': table + ball(50, 30),
  'ball-next-to-table': `<rect x="10" y="44" width="56" height="7" fill="currentColor"/>${line('M16 51 V92 M60 51 V92', 5)}` + ball(82, 80),

  // --- drag targets
  basket: `<path d="M8 40 H92 L82 90 H18 Z" fill="#d9a35b" stroke="${INK}" stroke-width="4"/>${line('M30 40 Q50 4 70 40', 5)}${line('M14 58 H86 M17 74 H83', 3)}`,
};

for (let n = 1; n <= 10; n++) {
  ENTRIES[`num-${n}`] = numeral(n);
  ENTRIES[`dots-${n}`] = dots(n);
}
for (const [name, hex] of Object.entries(PALETTE)) {
  ENTRIES[`color-${name}`] = swatch(hex);
}

export const SVG = Object.freeze(
  Object.fromEntries(Object.entries(ENTRIES).map(([k, body]) => [k, wrap(body)]))
);

// Returns the markup for a key, or null for an unknown key. Never throws, so a
// renderer can fall back to the text label.
export function svgFor(name) {
  return typeof name === 'string' && Object.hasOwn(SVG, name) ? SVG[name] : null;
}
