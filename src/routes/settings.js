import { json, readJson } from '../http.js';
import { isActiveApp } from '../db.js';
import { loadOwnedChild } from './children.js';

// Sensory settings per (child, app). A child with no saved row gets DEFAULTS,
// flagged is_default: true. Values are stored as the DB stores them (booleans
// as 0/1) and presented with real booleans.
const DEFAULTS = {
  volume: 60,
  flash_intensity: 50,
  animation_speed: 1,
  contrast: 'normal',
  animations: 1,
  safe_mode: 1,
};

const isIntIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const isBool = (v) => typeof v === 'boolean';
const boolToDb = (v) => (v ? 1 : 0);

// Whitelist of writable columns. Keys outside it are ignored; the column names
// below are the only ones ever interpolated into SQL. Wrong types are rejected,
// never coerced.
const FIELDS = {
  volume: { valid: isIntIn(0, 100), error: 'volume must be an integer 0-100' },
  flash_intensity: { valid: isIntIn(0, 100), error: 'flash_intensity must be an integer 0-100' },
  animation_speed: {
    valid: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.25 && v <= 2,
    error: 'animation_speed must be a number 0.25-2',
  },
  contrast: { valid: (v) => v === 'normal' || v === 'high', error: 'contrast must be "normal" or "high"' },
  animations: { valid: isBool, error: 'animations must be a boolean', toDb: boolToDb },
  // Photosensitivity safe mode is ON unless the client sends an explicit false.
  // Only `false` itself maps to 0; an omitted key is never written (see PUT).
  safe_mode: { valid: isBool, error: 'safe_mode must be a boolean', toDb: (v) => (v === false ? 0 : 1) },
};
const COLUMNS = Object.keys(FIELDS);

function present(childId, appId, row, isDefault) {
  return {
    child_id: childId,
    app_id: appId,
    volume: row.volume,
    flash_intensity: row.flash_intensity,
    animation_speed: row.animation_speed,
    contrast: row.contrast,
    animations: row.animations === 1,
    safe_mode: row.safe_mode === 1,
    is_default: isDefault,
  };
}

// Returns null if app_id is usable, otherwise the error Response.
async function checkAppId(env, appId) {
  if (typeof appId !== 'string' || !appId) return json({ error: 'app_id is required' }, 400);
  if (!(await isActiveApp(env.DB, appId))) return json({ error: 'App not found' }, 404);
  return null;
}

export async function handleGetSettings(request, env, user, id) {
  const child = await loadOwnedChild(env, user, id);
  if (child instanceof Response) return child;

  const appId = new URL(request.url).searchParams.get('app_id');
  const bad = await checkAppId(env, appId);
  if (bad) return bad;

  const row = await env.DB
    .prepare(`SELECT ${COLUMNS.join(', ')} FROM child_settings WHERE child_id = ? AND app_id = ?`)
    .bind(child.id, appId)
    .first();
  return json(row ? present(child.id, appId, row, false) : present(child.id, appId, DEFAULTS, true));
}

// Partial update: only keys present in the body change. A new row starts from
// DEFAULTS for every omitted key; an existing row keeps its stored value for
// every omitted key, because only the provided columns are in the SET list.
export async function handlePutSettings(request, env, user, id) {
  const child = await loadOwnedChild(env, user, id);
  if (child instanceof Response) return child;

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  const bad = await checkAppId(env, body.app_id);
  if (bad) return bad;

  const provided = COLUMNS.filter((c) => Object.hasOwn(body, c));
  for (const c of provided) {
    if (!FIELDS[c].valid(body[c])) return json({ error: FIELDS[c].error }, 400);
  }

  const values = COLUMNS.map((c) => {
    if (!provided.includes(c)) return DEFAULTS[c];
    const toDb = FIELDS[c].toDb;
    return toDb ? toDb(body[c]) : body[c];
  });
  const updates = [...provided.map((c) => `${c} = excluded.${c}`), 'updated_at = CURRENT_TIMESTAMP'];

  const [, read] = await env.DB.batch([
    env.DB
      .prepare(`INSERT INTO child_settings (child_id, app_id, ${COLUMNS.join(', ')})
                VALUES (?, ?, ${COLUMNS.map(() => '?').join(', ')})
                ON CONFLICT (child_id, app_id) DO UPDATE SET ${updates.join(', ')}`)
      .bind(child.id, body.app_id, ...values),
    env.DB
      .prepare(`SELECT ${COLUMNS.join(', ')} FROM child_settings WHERE child_id = ? AND app_id = ?`)
      .bind(child.id, body.app_id),
  ]);
  return json(present(child.id, body.app_id, read.results[0], false));
}
