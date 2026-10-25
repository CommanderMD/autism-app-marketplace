import { t } from './i18n.js';

// Shared DOM helpers. This is the only module that creates DOM nodes; views
// compose these. Text is always set with textContent, never innerHTML, so a
// name from the API can never become markup.

// el('button', { class: 'danger', type: 'button', onClick: fn }, 'Revoke')
// Attribute values of false/null/undefined are skipped; true sets an empty
// attribute. on<Event> keys become addEventListener calls.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (/^on[A-Z]/.test(key) && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'value' || key === 'checked' || key === 'indeterminate') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function replace(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

// A polite live region. Announcing the same text twice still fires, because
// the region is emptied first.
export function liveRegion(attrs = {}) {
  return el('p', { class: 'status', role: 'status', 'aria-live': 'polite', ...attrs });
}

export function announce(region, message) {
  region.textContent = '';
  // Next frame, so screen readers notice the change.
  requestAnimationFrame(() => { region.textContent = message; });
}

let uid = 0;
export function uniqueId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

// A labelled form field with an inline error slot. Returns { wrap, input, error }.
// kind: 'input' | 'select' | 'textarea'. options: [{ value, label }] for select.
export function field({ label, name, kind = 'input', type = 'text', hint, options = [], ...attrs }) {
  const id = uniqueId(name);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  let input;
  if (kind === 'select') {
    input = el('select', { id, name, 'aria-describedby': describedBy, ...attrs },
      options.map((o) => el('option', { value: o.value }, o.label)));
  } else if (kind === 'textarea') {
    input = el('textarea', { id, name, 'aria-describedby': describedBy, ...attrs });
  } else {
    input = el('input', { id, name, type, 'aria-describedby': describedBy, ...attrs });
  }
  const error = el('p', { class: 'error', id: errorId });
  const wrap = el('div', { class: 'field' },
    el('label', { for: id }, label),
    hint ? el('p', { class: 'hint', id: hintId }, hint) : null,
    input,
    error);
  return { wrap, input, error };
}

export function setFieldError(f, message) {
  f.error.textContent = message || '';
  if (message) f.input.setAttribute('aria-invalid', 'true');
  else f.input.removeAttribute('aria-invalid');
}

// A real <table> inside a labelled, keyboard-scrollable region.
// columns: [{ label, key?, render?(row), num? }]
// rowAttrs?(row) returns extra attributes for each <tr>.
export function table({ caption, columns, rows, rowAttrs }) {
  const t = el('table', {},
    el('caption', {}, caption),
    el('thead', {}, el('tr', {},
      columns.map((c) => el('th', { scope: 'col', class: c.num ? 'num' : null }, c.label)))),
    el('tbody', {}, rows.map((row) => el('tr', rowAttrs ? rowAttrs(row) : {},
      columns.map((c) => el('td', { class: c.num ? 'num' : null },
        c.render ? c.render(row) : formatCell(row[c.key])))))));
  return el('div', { class: 'table-scroll', role: 'region', 'aria-label': caption, tabindex: '0' }, t);
}

function formatCell(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export function heading(level, text, attrs = {}) {
  return el(`h${level}`, attrs, text);
}

export function notice(message, { error = false, children = [] } = {}) {
  return el('div', { class: error ? 'notice error' : 'notice', role: error ? 'alert' : null },
    el('p', {}, message), children);
}

// Disables a button while an async action runs, so it cannot be double-submitted.
export async function busy(button, task) {
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

export function ageRange(app) {
  if (app.age_min == null && app.age_max == null) return t('age.all');
  if (app.age_max == null) return t('age.from', { min: app.age_min });
  if (app.age_min == null) return t('age.upto', { max: app.age_max });
  return t('age.range', { min: app.age_min, max: app.age_max });
}
