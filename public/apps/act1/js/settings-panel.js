// Act 1 sensory settings panel. For the adult; a child tapping around cannot
// break anything: there is no destructive action here.
//
// Persistence rule (documented so nobody "fixes" it later):
//   - Every change is written to localStorage under STORAGE_KEY at once, with
//     savedAt = Date.now(), so a reload (even offline) keeps it.
//   - Every change is also PUT to the server, debounced DEBOUNCE_MS, with only
//     the keys that changed. A failed PUT keeps the local value and shows a
//     small note; the child never sees an error.
//   - On load, the server value wins unless the local copy has a newer
//     savedAt than the server row's updated_at. safe_mode is always sent as
//     an explicit boolean when it changes, because the server only turns it
//     off on an explicit false.
//
// localStorage holds settings only - sliders and switches - never a child id
// or name.

import { api } from '/js/api.js';
import { el, replace } from '/js/ui.js';

export const STORAGE_KEY = 'act1.settings.v1';
export const DEBOUNCE_MS = 400;
export const APP_ID = 'act1-sensory-learning';

export const DEFAULT_SETTINGS = Object.freeze({
  volume: 60,
  flash_intensity: 50,
  animation_speed: 1,
  contrast: 'normal',
  animations: true,
  safe_mode: true, // photosensitivity safe mode: ON unless an adult turns it off
});

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocal(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pick(settings), savedAt: Date.now() }));
  } catch {
    /* storage unavailable: the server copy still exists */
  }
}

function pick(s) {
  return {
    volume: s.volume,
    flash_intensity: s.flash_intensity,
    animation_speed: s.animation_speed,
    contrast: s.contrast,
    animations: s.animations,
    safe_mode: s.safe_mode,
  };
}

// Merge the server row with a possibly-newer local copy. serverUpdatedAt is
// the row's updated_at (UTC 'YYYY-MM-DD HH:MM:SS') or null for defaults.
export function resolveInitial(serverSettings, local, serverUpdatedAt = null) {
  const base = { ...DEFAULT_SETTINGS, ...pick(serverSettings || {}) };
  if (!local) return base;
  const serverMs = serverUpdatedAt ? Date.parse(`${serverUpdatedAt.replace(' ', 'T')}Z`) : 0;
  if (Number.isFinite(serverMs) && local.savedAt > serverMs) {
    return { ...base, ...pick({ ...base, ...local }) };
  }
  return base;
}

// Applies settings to the document so CSS can react. Called by the shell on
// every render as well, so the two never disagree.
export function applyToDocument(s) {
  const root = document.documentElement;
  root.dataset.contrast = s.contrast === 'high' ? 'high' : 'normal';
  root.dataset.animations = s.animations === false ? 'off' : 'on';
  root.dataset.safe = s.safe_mode === false ? 'off' : 'on';
  const speed = SPEEDS.includes(Number(s.animation_speed)) ? Number(s.animation_speed) : 1;
  root.style.setProperty('--anim-speed', String(speed));
}

export function createSettingsPanel({ childId, initial, onChange, onTestSound }) {
  let settings = { ...DEFAULT_SETTINGS, ...pick(initial || {}) };
  let pending = {};
  let timer = null;
  const note = el('p', { class: 'save-note', role: 'status', 'aria-live': 'polite' });

  function flush() {
    timer = null;
    const body = { app_id: APP_ID, ...pending };
    pending = {};
    if (Object.keys(body).length === 1) return;
    api(`/api/children/${encodeURIComponent(childId)}/settings`, { method: 'PUT', body })
      .then(() => { note.textContent = 'Saved.'; })
      .catch(() => { note.textContent = 'Saved on this device. It will sync when you are back online.'; });
  }

  function update(patch) {
    settings = { ...settings, ...patch };
    Object.assign(pending, patch);
    writeLocal(settings);
    applyToDocument(settings);
    onChange(settings);
    note.textContent = '';
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  // --- controls ---
  const volumeValue = el('span', { class: 'value' }, String(settings.volume));
  const volume = el('input', {
    type: 'range', min: '0', max: '100', step: '5', id: 'set-volume', value: String(settings.volume),
    'aria-describedby': 'set-volume-value',
  });
  volume.addEventListener('input', () => {
    volumeValue.textContent = volume.value;
    update({ volume: Number(volume.value) });
  });
  const testSound = el('button', { type: 'button', class: 'text-btn' }, 'Test sound');
  testSound.addEventListener('click', () => onTestSound && onTestSound());

  const flashValue = el('span', { class: 'value' }, String(settings.flash_intensity));
  const flash = el('input', {
    type: 'range', min: '0', max: '100', step: '5', id: 'set-flash', value: String(settings.flash_intensity),
    'aria-describedby': 'set-flash-value',
  });
  flash.addEventListener('input', () => {
    flashValue.textContent = flash.value;
    update({ flash_intensity: Number(flash.value) });
  });

  const speed = el('select', { id: 'set-speed' },
    SPEEDS.map((v) => el('option', { value: String(v) }, `${v}x`)));
  speed.value = String(settings.animation_speed);
  speed.addEventListener('change', () => update({ animation_speed: Number(speed.value) }));

  const contrastNormal = el('input', { type: 'radio', name: 'set-contrast', id: 'set-contrast-normal', value: 'normal' });
  const contrastHigh = el('input', { type: 'radio', name: 'set-contrast', id: 'set-contrast-high', value: 'high' });
  (settings.contrast === 'high' ? contrastHigh : contrastNormal).checked = true;
  for (const r of [contrastNormal, contrastHigh]) {
    r.addEventListener('change', () => { if (r.checked) update({ contrast: r.value }); });
  }

  const animations = el('input', { type: 'checkbox', id: 'set-animations' });
  animations.checked = settings.animations !== false;
  animations.addEventListener('change', () => update({ animations: animations.checked === true }));

  // Default-checked. Written as an explicit boolean so the server sees the change.
  const safeMode = el('input', { type: 'checkbox', id: 'set-safe' });
  safeMode.checked = settings.safe_mode !== false;
  safeMode.addEventListener('change', () => update({ safe_mode: safeMode.checked === true }));

  const close = el('button', { type: 'button', class: 'text-btn' }, 'Close');

  const panel = el('aside', { class: 'settings-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'settings-title', hidden: true },
    el('h2', { id: 'settings-title' }, 'Settings for grown-ups'),
    el('div', { class: 'row' },
      el('label', { for: 'set-volume' }, 'Volume ', volumeValue),
      el('span', { class: 'visually-hidden', id: 'set-volume-value' }, 'out of 100'),
      volume, testSound),
    el('div', { class: 'row' },
      el('label', { for: 'set-flash' }, 'Flash intensity ', flashValue),
      el('span', { class: 'visually-hidden', id: 'set-flash-value' }, 'out of 100'),
      flash),
    el('div', { class: 'row' }, el('label', { for: 'set-speed' }, 'Animation speed'), speed),
    el('div', { class: 'row' },
      el('span', { class: 'value' }, 'Contrast'),
      el('div', { class: 'check' }, contrastNormal, el('label', { for: 'set-contrast-normal' }, 'Normal')),
      el('div', { class: 'check' }, contrastHigh, el('label', { for: 'set-contrast-high' }, 'High'))),
    el('div', { class: 'check' }, animations, el('label', { for: 'set-animations' }, 'Animations on')),
    el('div', { class: 'row' },
      el('div', { class: 'check' }, safeMode, el('label', { for: 'set-safe' }, 'Photosensitivity safe mode')),
      el('p', { class: 'note' }, 'Keeps flashing and big colour changes off. Leave this on unless you know it is safe for this child.')),
    note,
    close);

  close.addEventListener('click', () => { panel.hidden = true; });

  return {
    panel,
    get settings() { return { ...settings }; },
    open() { panel.hidden = false; volume.focus(); },
    close() { panel.hidden = true; },
    toggle() { panel.hidden ? this.open() : this.close(); },
    flushNow() { if (timer) { clearTimeout(timer); flush(); } },
  };
}
