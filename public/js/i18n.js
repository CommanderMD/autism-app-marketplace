// i18n scaffold (Phase 5). UI strings live in /i18n/<lang>.json; this module
// loads the chosen language plus English as the fallback and exposes t().
//
// Two kinds of lookup:
//   t('storefront.title')      - a UI string by dotted key, with {vars}
//   tr('Touch the circle.')    - a lesson string by its English source text,
//                                so lesson files stay plain English and the
//                                translation table can grow one line at a time
// Both fall back to English, then to the key / source text, so a missing
// translation is visible as English, never as a blank.
//
// The choice is a device preference (localStorage 'lang'), not a child
// setting: nothing about a child is involved. The spoken prompt in Act 1 uses
// speechLang() so audio follows the UI language.

export const LANGS = Object.freeze([
  { code: 'en', label: 'English', speech: 'en-US' },
  { code: 'es', label: 'Español', speech: 'es-ES' },
]);
const STORAGE_KEY = 'lang';
const DEFAULT = 'en';

const messages = new Map(); // code -> parsed JSON
let current = DEFAULT;

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(code) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode: the choice lasts this page only */ }
}

export function isLang(code) {
  return LANGS.some((l) => l.code === code);
}

// Stored choice, else the browser's first matching language, else English.
export function detectLang() {
  const stored = readStored();
  if (isLang(stored)) return stored;
  const nav = typeof navigator !== 'undefined' ? [navigator.language, ...(navigator.languages || [])] : [];
  for (const tag of nav) {
    const code = String(tag || '').slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return DEFAULT;
}

async function fetchMessages(code) {
  if (messages.has(code)) return messages.get(code);
  const res = await fetch(`/i18n/${code}.json`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`i18n ${code} ${res.status}`);
  const data = await res.json();
  messages.set(code, data);
  return data;
}

// Loads the language (and English) and sets <html lang>. Safe to call more
// than once. Resolves to the active code.
export async function initI18n(code = detectLang()) {
  const want = isLang(code) ? code : DEFAULT;
  const loads = [fetchMessages(DEFAULT)];
  if (want !== DEFAULT) loads.push(fetchMessages(want).catch(() => null));
  await Promise.all(loads);
  current = messages.has(want) ? want : DEFAULT;
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

export function currentLang() {
  return current;
}

// BCP-47 tag for SpeechSynthesisUtterance.lang.
export function speechLang() {
  return (LANGS.find((l) => l.code === current) || LANGS[0]).speech;
}

function lookup(code, key) {
  const data = messages.get(code);
  if (!data) return undefined;
  let node = data;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function t(key, vars = {}) {
  const text = lookup(current, key) ?? lookup(DEFAULT, key) ?? key;
  return interpolate(text, vars);
}

// Lesson strings, keyed by English source text under "lesson".
export function tr(source) {
  if (typeof source !== 'string' || !source) return source;
  const data = messages.get(current);
  const table = data && data.lesson;
  return table && typeof table[source] === 'string' ? table[source] : source;
}

// Persists the choice and reloads so every view renders in the new language.
export function setLang(code) {
  if (!isLang(code) || code === current) return;
  writeStored(code);
  location.reload();
}

// A labelled <select> for the site header and the Act 1 grown-ups' panel.
export function languageSwitcher({ visible = false } = {}) {
  const doc = document;
  const id = 'lang-switch';
  const label = doc.createElement('label');
  label.className = 'lang-switch';
  label.setAttribute('for', id);
  const text = doc.createElement('span');
  if (!visible) text.className = 'visually-hidden';
  text.textContent = t('common.language');
  const select = doc.createElement('select');
  select.id = id;
  select.name = 'lang';
  select.setAttribute('aria-label', t('common.language'));
  for (const l of LANGS) {
    const opt = doc.createElement('option');
    opt.value = l.code;
    opt.textContent = l.label;
    opt.lang = l.code;
    if (l.code === current) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => setLang(select.value));
  label.append(text, select);
  return label;
}
