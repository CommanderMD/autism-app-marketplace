import { json, readJson } from '../http.js';
import { audit, listAudit } from '../audit.js';

// platform_admin only; the router enforces the role before calling these.

const APP_COLUMNS = 'id, name, description, category, subcategory, age_min, age_max, difficulty_level, is_active, created_at, updated_at';
const SCHOOL_COLUMNS = 'id, name, contact_email, contact_phone, address, is_active, created_at, updated_at';
const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

// Validators return [value] on success or [undefined, error]. Field names are
// a fixed allowlist, so no request key ever reaches SQL as an identifier.
const APP_FIELDS = {
  name: (v) => (typeof v === 'string' && v.trim() && v.trim().length <= 200 ? [v.trim()] : [undefined, 'name is required (max 200 chars)']),
  description: (v) => (v === null || (typeof v === 'string' && v.length <= 2000) ? [v] : [undefined, 'description must be a string (max 2000 chars)']),
  category: (v) => (typeof v === 'string' && v.trim() && v.trim().length <= 100 ? [v.trim()] : [undefined, 'category is required (max 100 chars)']),
  subcategory: (v) => (v === null || (typeof v === 'string' && v.length <= 100) ? [v] : [undefined, 'subcategory must be a string (max 100 chars)']),
  age_min: (v) => (v === null || (Number.isInteger(v) && v >= 0 && v <= 99) ? [v] : [undefined, 'age_min must be an integer 0-99']),
  age_max: (v) => (v === null || (Number.isInteger(v) && v >= 0 && v <= 99) ? [v] : [undefined, 'age_max must be an integer 0-99']),
  difficulty_level: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 5) ? [v] : [undefined, 'difficulty_level must be an integer 1-5']),
};

function pickAppFields(body, fields) {
  const values = {};
  for (const field of fields) {
    if (body[field] === undefined) continue;
    const [value, error] = APP_FIELDS[field](body[field]);
    if (error) return { error };
    values[field] = value;
  }
  return { values };
}

export async function handleAdminListApps(request, env) {
  const { results } = await env.DB.prepare(`SELECT ${APP_COLUMNS} FROM apps ORDER BY name, id`).all();
  return json(results);
}

export async function handleAdminCreateApp(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  for (const required of ['name', 'category']) {
    if (body[required] === undefined) return json({ error: `${required} is required` }, 400);
  }
  const { values, error } = pickAppFields(body, Object.keys(APP_FIELDS));
  if (error) return json({ error }, 400);

  const id = body.id === undefined || body.id === null ? slugify(values.name) : body.id;
  if (typeof id !== 'string' || !APP_ID_RE.test(id)) {
    return json({ error: 'id must be lowercase a-z, 0-9 and dashes (max 100 chars)' }, 400);
  }

  const columns = ['id', ...Object.keys(values)];
  try {
    await env.DB
      .prepare(`INSERT INTO apps (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .bind(id, ...Object.values(values))
      .run();
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) return json({ error: 'An app with this id already exists' }, 409);
    return json({ error: 'Internal error' }, 500);
  }
  await audit(env, { actor: user, action: 'app.create', targetType: 'app', targetId: id, detail: { fields: columns } });
  const app = await env.DB.prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE id = ?`).bind(id).first();
  return json(app, 201);
}

export async function handleAdminUpdateApp(request, env, user, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const { values, error } = pickAppFields(body, Object.keys(APP_FIELDS));
  if (error) return json({ error }, 400);
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return json({ error: 'is_active must be a boolean' }, 400);
    values.is_active = body.is_active ? 1 : 0;
  }
  const fields = Object.keys(values);
  if (fields.length === 0) return json({ error: 'No updatable fields in body' }, 400);

  const result = await env.DB
    .prepare(`UPDATE apps SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(...Object.values(values), id)
    .run();
  if (result.meta.changes === 0) return json({ error: 'App not found' }, 404);
  await audit(env, { actor: user, action: 'app.update', targetType: 'app', targetId: id,
    detail: { fields, is_active: values.is_active ?? null } });
  const app = await env.DB.prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE id = ?`).bind(id).first();
  return json(app);
}

export async function handleAdminListSchools(request, env) {
  const { results } = await env.DB.prepare(`SELECT ${SCHOOL_COLUMNS} FROM schools ORDER BY name, id`).all();
  return json(results);
}

export async function handleAdminCreateSchool(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return json({ error: 'name is required (max 200 chars)' }, 400);
  let contactEmail = null;
  if (body.contact_email !== undefined && body.contact_email !== null) {
    contactEmail = typeof body.contact_email === 'string' ? body.contact_email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(contactEmail) || contactEmail.length > 254) {
      return json({ error: 'contact_email must be a valid address' }, 400);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO schools (id, name, contact_email) VALUES (?, ?, ?)').bind(id, name, contactEmail).run();
  await audit(env, { actor: user, action: 'school.create', targetType: 'school', targetId: id });
  const school = await env.DB.prepare(`SELECT ${SCHOOL_COLUMNS} FROM schools WHERE id = ?`).bind(id).first();
  return json(school, 201);
}

export async function handleAdminAssignSchool(request, env, actor, userId) {
  const body = await readJson(request);
  const schoolId = body && typeof body.school_id === 'string' ? body.school_id : '';
  if (!schoolId) return json({ error: 'school_id is required' }, 400);

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first();
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.role !== 'school_admin') return json({ error: 'Only a school_admin can be assigned to a school' }, 400);

  const school = await env.DB.prepare('SELECT 1 AS found FROM schools WHERE id = ?').bind(schoolId).first();
  if (!school) return json({ error: 'school_id does not exist' }, 400);

  await env.DB.prepare('UPDATE users SET school_id = ? WHERE id = ?').bind(schoolId, userId).run();
  await audit(env, { actor, action: 'user.assign_school', targetType: 'user', targetId: userId, detail: { school_id: schoolId } });
  const user = await env.DB.prepare('SELECT id, email, role, school_id FROM users WHERE id = ?').bind(userId).first();
  return json(user);
}

// GET /api/admin/audit?limit=&before= - newest first. detail is ids and
// counts only (src/audit.js strips anything else before it is written).
export async function handleAdminAudit(request, env) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') || 100);
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw === null ? null : Number(beforeRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return json({ error: 'limit must be an integer 1-500' }, 400);
  if (before !== null && (!Number.isInteger(before) || before < 1)) return json({ error: 'before must be a positive integer id' }, 400);
  return json(await listAudit(env, { limit, before }));
}
