#!/usr/bin/env node
// Computes WCAG 2.x contrast ratios for the colour pairs the UI actually uses,
// reading token values from the :root block of public/css/app.css.
//
//   node scripts/contrast.mjs          print the table; exit 1 if a pair fails
//   node scripts/contrast.mjs --write  also rewrite the table inside app.css
import { readFileSync, writeFileSync } from 'node:fs';

const CSS_PATH = new URL('../public/css/app.css', import.meta.url);

// [foreground, background, minimum ratio, where it is used]
const PAIRS = [
  ['--text', '--bg', 4.5, 'body text'],
  ['--text', '--surface', 4.5, 'text in cards, table headers'],
  ['--text', '--surface-inactive', 4.5, 'deactivated table rows, disabled buttons'],
  ['--text-muted', '--bg', 4.5, 'hints, footer'],
  ['--text-muted', '--surface', 4.5, 'card meta text'],
  ['--text-muted', '--surface-inactive', 4.5, 'meta text in deactivated rows'],
  ['--accent', '--bg', 4.5, 'links, secondary buttons'],
  ['--accent', '--surface', 4.5, 'links inside cards'],
  ['--accent-text', '--accent', 4.5, 'primary button label'],
  ['--accent-text', '--danger', 4.5, 'danger button label'],
  ['--danger', '--bg', 4.5, 'error text'],
  ['--danger', '--surface', 4.5, 'error text in cards, "Inactive" badge'],
  ['--danger', '--surface-inactive', 4.5, '"Inactive" badge on deactivated rows'],
  ['--success', '--surface', 4.5, '"Active" badge'],
  ['--focus', '--bg', 3, 'focus ring (non-text)'],
  ['--focus', '--surface', 3, 'focus ring on cards (non-text)'],
  ['--border-strong', '--bg', 3, 'input borders, bar track (non-text)'],
  ['--accent', '--bg', 3, 'usage bar fill (non-text)'],
];

function readTokens(css) {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root) throw new Error('No :root block in app.css');
  const tokens = {};
  for (const [, name, value] of root[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[name] = value.toLowerCase();
  return tokens;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(CSS_PATH, 'utf8');
const tokens = readTokens(css);
let failed = 0;
const lines = PAIRS.map(([fg, bg, min, use]) => {
  if (!tokens[fg] || !tokens[bg]) throw new Error(`Missing token ${tokens[fg] ? bg : fg}`);
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= min;
  if (!ok) failed++;
  return `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}`.padEnd(64) +
    `${r.toFixed(2)}:1  (min ${min}:1) ${ok ? 'ok  ' : 'FAIL'}  ${use}`;
});

console.log(lines.join('\n'));

if (process.argv.includes('--write')) {
  const block = lines.map((l) => ` *   ${l}`).join('\n');
  const next = css.replace(
    /( \*   CONTRAST-TABLE-START\n)[\s\S]*?( \*   CONTRAST-TABLE-END)/,
    `$1${block}\n$2`
  );
  writeFileSync(CSS_PATH, next);
  console.log('\nTable written to public/css/app.css');
}

if (failed) {
  console.error(`\n${failed} pair(s) below minimum`);
  process.exit(1);
}
