import { json, readJson } from '../http.js';

const CHILD_COLUMNS = 'id, name, birth_date, graduation_date, school_id, parent_id, created_at, updated_at';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCESS_COLUMNS = 'child_id, app_id, granted_by, granted_at, expires_at, is_active';

// Upsert tail for child_app_access grants. Active grants are left untouched
// (meta.changes = 0); revoked ones are switched back on (meta.changes = 1).
export const REACTIVATE_ON_CONFLICT = `ON CONFLICT (child_id, app_id) DO UPDATE
  SET is_active = 1, granted_by = excluded.granted_by, granted_at = CURRENT_TIMESTAMP
  WHERE child_app_access.is_active = 0`;

// Ownership scope as a SQL fragment, so rows the caller does not own are never
// read from D1. A school_admin with no school matches nothing (NULL = NULL is false).
export function childScope(user) {
  switch (user.role) {
    case 'platform_admin':
      return { clause: '1 = 1', params: [] };
    case 'parent':
      return { clause: 'parent_id = ?', params: [user.id] };
    case 'school_admin':
      return { clause: 'school_id = ?', params: [user.school_id] };
    default:
      return { clause: '1 = 0', params: [] };
  }
}

// Returns the child if the caller owns it, otherwise a 403/404 Response.
// The existence check only returns a boolean; no row data leaves D1 for
// a child the caller does not own.
export async function loadOwnedChild(env, user, id) {
  const scope = childScope(user);
  const child = await env.DB
    .prepare(`SELECT ${CHILD_COLUMNS} FROM children WHERE id = ? AND ${scope.clause}`)
    .bind(id, ...scope.params)
    .first();
  if (child) return child;
  const exists = await env.DB.prepare('SELECT 1 AS found FROM children WHERE id = ?').bind(id).first();
  return exists ? json({ error: 'Forbidden' }, 403) : json({ error: 'Child not found' }, 404);
}

export async function handleCreateChild(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return json({ error: 'name is required (max 200 chars)' }, 400);

  const birthDate = body.birth_date ?? null;
  if (birthDate !== null && (typeof birthDate !== 'string' || !DATE_RE.test(birthDate))) {
    return json({ error: 'birth_date must be YYYY-MM-DD' }, 400);
  }

  const requestedSchool = body.school_id ?? null;
  if (requestedSchool !== null && typeof requestedSchool !== 'string') {
    return json({ error: 'school_id must be a string' }, 400);
  }

  // Ownership always comes from the session, never from the body.
  // body.parent_id is ignored on purpose.
  let parentId = null;
  let schoolId = null;
  if (user.role === 'parent') {
    parentId = user.id; // parents.id === users.id
    if (requestedSchool !== null && requestedSchool !== user.school_id) {
      return json({ error: 'You may not assign this school' }, 403);
    }
    schoolId = requestedSchool;
  } else if (user.role === 'school_admin') {
    if (!user.school_id) return json({ error: 'Your account is not linked to a school' }, 403);
    if (requestedSchool !== null && requestedSchool !== user.school_id) {
      return json({ error: 'You may not assign this school' }, 403);
    }
    schoolId = user.school_id;
  } else if (user.role === 'platform_admin') {
    if (requestedSchool !== null) {
      const school = await env.DB.prepare('SELECT 1 AS found FROM schools WHERE id = ?').bind(requestedSchool).first();
      if (!school) return json({ error: 'school_id does not exist' }, 400);
    }
    schoolId = requestedSchool;
  }

  const id = crypto.randomUUID();
  await env.DB
    .prepare('INSERT INTO children (id, name, birth_date, school_id, parent_id) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, birthDate, schoolId, parentId)
    .run();

  const child = await env.DB.prepare(`SELECT ${CHILD_COLUMNS} FROM children WHERE id = ?`).bind(id).first();
  return json(child, 201);
}

export async function handleListChildren(request, env, user) {
  const scope = childScope(user);
  const { results } = await env.DB
    .prepare(`SELECT ${CHILD_COLUMNS} FROM children WHERE ${scope.clause} ORDER BY created_at, id`)
    .bind(...scope.params)
    .all();
  return json(results);
}

export async function handleGetChild(request, env, user, id) {
  const child = await loadOwnedChild(env, user, id);
  return child instanceof Response ? child : json(child);
}

export async function handleGrantApp(request, env, user, id) {
  const child = await loadOwnedChild(env, user, id);
  if (child instanceof Response) return child;

  const body = await readJson(request);
  const appId = body && typeof body.app_id === 'string' ? body.app_id : '';
  if (!appId) return json({ error: 'app_id is required' }, 400);

  const app = await env.DB.prepare('SELECT 1 AS found FROM apps WHERE id = ? AND is_active = 1').bind(appId).first();
  if (!app) return json({ error: 'App not found' }, 404);

  // Idempotent on UNIQUE(child_id, app_id): a repeat grant of an active app
  // changes nothing. A revoked grant (is_active = 0) is reactivated.
  const result = await env.DB
    .prepare(`INSERT INTO child_app_access (child_id, app_id, granted_by) VALUES (?, ?, ?)
              ${REACTIVATE_ON_CONFLICT}`)
    .bind(child.id, appId, user.id)
    .run();

  const access = await env.DB
    .prepare(`SELECT ${ACCESS_COLUMNS} FROM child_app_access WHERE child_id = ? AND app_id = ?`)
    .bind(child.id, appId)
    .first();
  return json(access, result.meta.changes > 0 ? 201 : 200);
}

// Soft revoke: is_active = 0 keeps the grant row (and its usage history).
// Revoking an already-revoked grant is a no-op that still returns 200.
export async function handleRevokeApp(request, env, user, id, appId) {
  const child = await loadOwnedChild(env, user, id);
  if (child instanceof Response) return child;

  await env.DB
    .prepare('UPDATE child_app_access SET is_active = 0 WHERE child_id = ? AND app_id = ? AND is_active != 0')
    .bind(child.id, appId)
    .run();

  const access = await env.DB
    .prepare(`SELECT ${ACCESS_COLUMNS} FROM child_app_access WHERE child_id = ? AND app_id = ?`)
    .bind(child.id, appId)
    .first();
  if (!access) return json({ error: 'App is not granted to this child' }, 404);
  return json(access);
}
