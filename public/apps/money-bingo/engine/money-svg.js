// Money Bingo inline SVG library: key -> SVG markup string.
//
// Same family style as public/apps/act1/engine/svg.js so the apps look
// related: a 100x100 viewBox, round-capped ink outlines, currentColor for the
// single-colour marks, light fills under dark ink. Every picture below is
// drawn for this project from geometric primitives and text; nothing is
// traced or copied from any other product.
//
// Rules each entry follows (validateMoneySvg enforces them at load):
// - self-contained <svg viewBox="0 0 100 100" role="img" aria-hidden="true">;
//   the accessible name is the item's spoken label, not the picture
// - no <script>, no <image>, no <foreignObject>, no href, no event
//   attributes, no "http" anywhere (inline in HTML, so no xmlns either)
//
// Colour is never the only cue: every coin and bill carries its value as
// text, coins also differ in size (dime smallest, quarter largest, as in the
// hand), and every fill sits under a #14181f outline. Fills are light so the
// ink text on them stays well above 4.5:1.

import { ITEMS } from './items.js';

const INK = '#14181f';
const COPPER = '#e7b98a';
const SILVER = '#d1d5db';
const BILL = '#bbf7d0';
const PINK = '#f9a8d4';

export const SVG_OPEN = '<svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">';
const wrap = (body) => `${SVG_OPEN}${body}</svg>`;

const line = (d, w = 5, colour = 'currentColor') =>
  `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const label = (text, y, size) =>
  `<text x="50" y="${y}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="${size}" fill="${INK}">${text}</text>`;

// A coin: outer edge, an inner rim, and the value. r sets the size.
const coin = (r, fill, value, size) =>
  `<circle cx="50" cy="50" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="4"/>` +
  `<circle cx="50" cy="50" r="${r - 7}" fill="none" stroke="${INK}" stroke-width="2"/>` +
  label(value, 50 + size * 0.36, size);

// A bill: one shape for all four, the value in the middle and in two corners.
const bill = (value, size) =>
  `<rect x="6" y="24" width="88" height="52" rx="6" fill="${BILL}" stroke="${INK}" stroke-width="4"/>` +
  `<rect x="13" y="31" width="74" height="38" rx="3" fill="none" stroke="${INK}" stroke-width="2"/>` +
  `<ellipse cx="50" cy="50" rx="20" ry="15" fill="#f0fdf4" stroke="${INK}" stroke-width="2"/>` +
  label(value, 50 + size * 0.36, size);

const symbol = (char) =>
  `<text x="50" y="80" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="84" fill="currentColor">${char}</text>`;

const ENTRIES = {
  // --- coins (value text + relative size)
  penny: coin(34, COPPER, '1¢', 24),
  nickel: coin(38, SILVER, '5¢', 26),
  dime: coin(30, SILVER, '10¢', 20),
  quarter: coin(44, SILVER, '25¢', 28),

  // --- bills
  'one-dollar': bill('$1', 26),
  'five-dollars': bill('$5', 26),
  'ten-dollars': bill('$10', 24),
  'twenty-dollars': bill('$20', 24),

  // --- symbols
  'dollar-sign': symbol('$'),
  'cent-sign': symbol('¢'),

  // --- concepts
  // A folded wallet with a bill peeking out and a snap flap.
  wallet:
    `<rect x="18" y="18" width="44" height="18" rx="2" fill="${BILL}" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="10" y="28" width="80" height="54" rx="8" fill="#a16207" stroke="${INK}" stroke-width="4"/>` +
    `<path d="M58 44 H90 V68 H58 Q52 68 52 62 V50 Q52 44 58 44 Z" fill="#ca8a04" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="64" cy="56" r="4" fill="${INK}"/>`,
  // A bag with an arched handle and a two-ball clasp.
  purse:
    line('M32 46 Q32 14 50 14 Q68 14 68 46', 5, INK) +
    `<path d="M16 44 H84 L92 88 H8 Z" fill="#c4b5fd" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<circle cx="45" cy="44" r="4.5" fill="${INK}"/><circle cx="55" cy="44" r="4.5" fill="${INK}"/>`,
  // A pig with a coin slot on its back.
  'piggy-bank':
    `<rect x="26" y="70" width="9" height="18" rx="2" fill="${PINK}" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="58" y="70" width="9" height="18" rx="2" fill="${PINK}" stroke="${INK}" stroke-width="3"/>` +
    `<polygon points="58,36 66,20 72,38" fill="${PINK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="48" cy="56" rx="34" ry="24" fill="${PINK}" stroke="${INK}" stroke-width="4"/>` +
    `<ellipse cx="84" cy="58" rx="8" ry="10" fill="${PINK}" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="82" cy="55" r="1.8" fill="${INK}"/><circle cx="86" cy="61" r="1.8" fill="${INK}"/>` +
    `<circle cx="68" cy="48" r="3" fill="${INK}"/>` +
    `<rect x="38" y="31" width="20" height="5" rx="2.5" fill="${INK}"/>` +
    line('M14 52 Q6 48 10 40', 3, INK),
  // Spend: a coin going into a shopping cart.
  spend:
    line('M8 30 H20 L30 68 H78 L86 40 H24', 5) +
    `<circle cx="36" cy="80" r="6" fill="currentColor"/><circle cx="72" cy="80" r="6" fill="currentColor"/>` +
    `<circle cx="76" cy="16" r="11" fill="${COPPER}" stroke="${INK}" stroke-width="3"/>` +
    line('M66 24 L54 50 M50 40 L54 50 L64 46', 4, INK),
  // Save: coins going down into a jar with a lid.
  save:
    `<path d="M28 32 H72 V82 Q72 90 64 90 H36 Q28 90 28 82 Z" fill="#e0f2fe" stroke="${INK}" stroke-width="4"/>` +
    `<rect x="24" y="22" width="52" height="10" rx="3" fill="currentColor"/>` +
    `<ellipse cx="50" cy="80" rx="14" ry="5" fill="${COPPER}" stroke="${INK}" stroke-width="2"/>` +
    `<ellipse cx="50" cy="72" rx="14" ry="5" fill="${COPPER}" stroke="${INK}" stroke-width="2"/>` +
    line('M50 40 V60 M42 52 L50 60 L58 52', 4, INK),
};

export const MONEY_SVG = Object.freeze(
  Object.fromEntries(Object.entries(ENTRIES).map(([k, body]) => [k, wrap(body)]))
);

const FORBIDDEN = /<script|<image|<foreignObject|href|\son[a-z]+\s*=|http/i;

// Throws, naming the key, if any item's SVG key is missing from the map or its
// markup breaks the rules above. Mirrors validateLesson in act1/engine/lesson.js:
// a bad entry fails loudly at load, never silently at render.
export function validateMoneySvg(map = MONEY_SVG, keys = ITEMS.map((i) => i.svg)) {
  if (!map || typeof map !== 'object') throw new Error('money-svg: map is not an object');
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('money-svg: no keys to validate');
  for (const key of keys) {
    if (typeof key !== 'string' || !key) throw new Error('money-svg: an item has no svg key');
    if (!Object.hasOwn(map, key)) throw new Error(`money-svg: missing key "${key}"`);
    const markup = map[key];
    if (typeof markup !== 'string') throw new Error(`money-svg: "${key}" is not a string`);
    if (!markup.startsWith(SVG_OPEN)) throw new Error(`money-svg: "${key}" does not open with the 100x100 inline <svg>`);
    if (!markup.endsWith('</svg>')) throw new Error(`money-svg: "${key}" does not close with </svg>`);
    if (markup.length <= SVG_OPEN.length + '</svg>'.length) throw new Error(`money-svg: "${key}" is empty`);
    if (FORBIDDEN.test(markup)) throw new Error(`money-svg: "${key}" contains forbidden markup`);
  }
  return true;
}

// Fail at load, not at render.
validateMoneySvg();

// Markup for a key, or null. Never throws, so a renderer can fall back to text.
export function moneySvgFor(key) {
  return typeof key === 'string' && Object.hasOwn(MONEY_SVG, key) ? MONEY_SVG[key] : null;
}
