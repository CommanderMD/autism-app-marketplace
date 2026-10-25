import { json, readJson, todayUtc } from '../http.js';
import { audit } from '../audit.js';
import { GRANT_LIVE } from './children.js';

// Funding model (migration 008, docs/BILLING.md).
//
// A child with a school_id is seated through that school's licenses. A child
// with no school is self-funded and never seat-checked. Seats in use = live
// grants (GRANT_LIVE) to children of the school for the app. A license is
// current when starts_at <= today <= ends_at (ends_at NULL = open-ended).
//
// Known limit: the check and the insert are two statements, so two grants
// racing for the last seat can both succeed and oversubscribe by one. The
// school dashboard shows seats_used > seats as "over" so it is visible, and
// the nightly rollup does not touch it. Acceptable for this phase.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FUNDING = ['school', 'grant', 'district', 'self'];
const LICENSE_COLUMNS = 'id, school_id, app_id, funding_source_id, seats, starts_at, ends_at, notes, created_by, created_at';
const CURRENT = "l.starts_at <= date('now') AND (l.ends_at IS NULL OR l.ends_at >= date('now'))";

// Seats available right now for (school, app): { seats, used, free }.
export async function seatStatus(env, schoolId, appId) {
  const [lic, used] = await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(l.seats), 0) AS seats FROM school_licenses l
                    WHERE l.school_id = ? AND l.app_id = ? AND ${CURRENT}`).bind(schoolId, appId),
    env.DB.prepare(`SELECT COUNT(*) AS used FROM child_app_access a JOIN children c ON c.id = a.child_id
                    WHERE c.school_id = ? AND a.app_id = ? AND ${GRANT_LIVE}`).bind(schoolId, appId),
  ]);
  const seats = lic.results[0].seats;
  const inUse = used.results[0].used;
  return { seats, used: inUse, free: Math.max(0, seats - inUse) };
}

// Returns null when `needed` new seats can be taken, else a 409 Response.
// The error names counts only; never a child.
export async function requireSeats(env, schoolId, appId, needed) {
  if (needed <= 0) return null;
  const status = await seatStatus(env, schoolId, appId);
  if (status.free >= needed) return null;
  const error = status.seats === 0
    ? 'The school has no current license for this app. Ask the platform admin to add seats.'
    : `Not enough seats: ${status.free} free of ${status.seats}, ${needed} needed.`;
  return json({ error, code: 'no_seats', seats: status.seats, used: status.used, free: status.free, needed }, 409);
}

async function licensesWithUsage(env, schoolId) {
  const { results } = await env.DB
    .prepare(`SELECT ${LICENSE_COLUMNS.split(', ').map((c) => `l.${c}`).join(', ')},
                     p.name AS app_name,
                     CASE WHEN ${CURRENT} THEN 1 ELSE 0 END AS is_current
              FROM school_licenses l JOIN apps p ON p.id = l.app_id
              WHERE l.school_id = ?
              ORDER BY l.app_id, l.starts_at DESC, l.id`)
    .bind(schoolId)
    .all();
  // Seats used are per (school, app), so the same number appears on every
  // license row for that app: licenses pool.
  const apps = [...new Set(results.map((r) => r.app_id))];
  const statuses = await Promise.all(apps.map((a) => seatStatus(env, schoolId, a)));
  const byApp = Object.fromEntries(apps.map((a, i) => [a, statuses[i]]));
  return results.map((r) => ({ ...r, is_current: r.is_current === 1, pool: byApp[r.app_id] }));
}

// school_admin: own school's licenses.
export async function handleSchoolLicenses(request, env, user) {
  if (!user.school_id) return json({ error: 'Your account is not linked to a school' }, 403);
  return json(await licensesWithUsage(env, user.school_id));
}

// platform_admin: any school's licenses.
export async function handleAdminListLicenses(request, env, schoolId) {
  const school = await env.DB.prepare('SELECT 1 AS found FROM schools WHERE id = ?').bind(schoolId).first();
  if (!school) return json({ error: 'School not found' }, 404);
  return json(await licensesWithUsage(env, schoolId));
}

// platform_admin: add a license. Body: app_id, seats, starts_at, ends_at?, funding_source_id?, notes?
export async function handleAdminCreateLicense(request, env, user, schoolId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  const school = await env.DB.prepare('SELECT 1 AS found FROM schools WHERE id = ?').bind(schoolId).first();
  if (!school) return json({ error: 'School not found' }, 404);

  const appId = typeof body.app_id === 'string' ? body.app_id : '';
  if (!appId) return json({ error: 'app_id is required' }, 400);
  const app = await env.DB.prepare('SELECT 1 AS found FROM apps WHERE id = ? AND is_active = 1').bind(appId).first();
  if (!app) return json({ error: 'App not found' }, 404);

  const seats = body.seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > 100000) return json({ error: 'seats must be an integer 1-100000' }, 400);

  const startsAt = body.starts_at ?? todayUtc();
  if (typeof startsAt !== 'string' || !DATE_RE.test(startsAt)) return json({ error: 'starts_at must be YYYY-MM-DD' }, 400);
  const endsAt = body.ends_at ?? null;
  if (endsAt !== null && (typeof endsAt !== 'string' || !DATE_RE.test(endsAt))) return json({ error: 'ends_at must be YYYY-MM-DD or null' }, 400);
  if (endsAt !== null && endsAt < startsAt) return json({ error: 'ends_at must not be before starts_at' }, 400);

  const funding = body.funding_source_id ?? 'school';
  if (!FUNDING.includes(funding)) return json({ error: `funding_source_id must be one of ${FUNDING.join(', ')}` }, 400);

  const notes = body.notes ?? null;
  if (notes !== null && (typeof notes !== 'string' || notes.length > 500)) return json({ error: 'notes must be a string (max 500 chars)' }, 400);

  const id = crypto.randomUUID();
  await env.DB
    .prepare(`INSERT INTO school_licenses (id, school_id, app_id, funding_source_id, seats, starts_at, ends_at, notes, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, schoolId, appId, funding, seats, startsAt, endsAt, notes, user.id)
    .run();
  await audit(env, { actor: user, action: 'license.create', targetType: 'license', targetId: id,
    detail: { school_id: schoolId, app_id: appId, seats, starts_at: startsAt, ends_at: endsAt, funding_source_id: funding } });

  const row = await env.DB.prepare(`SELECT ${LICENSE_COLUMNS} FROM school_licenses WHERE id = ?`).bind(id).first();
  return json(row, 201);
}

export async function handleFundingSources(request, env) {
  const { results } = await env.DB.prepare('SELECT id, name, description FROM funding_sources ORDER BY id').all();
  return json(results);
}
