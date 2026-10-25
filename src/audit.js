// Append-only audit log for admin and school-admin actions (migration 009).
//
// `detail` must be ids, counts and field names only. It is JSON-encoded here
// and size-capped so a caller cannot accidentally stuff a request body (which
// might carry a child's name) into the log. Rule A4: no names, no emails, no IPs.

const MAX_DETAIL = 1000;
const FORBIDDEN_KEYS = /name|email|phone|address|birth|password|token|cookie/i;

export function sanitizeDetail(detail) {
  if (detail === undefined || detail === null) return null;
  const clean = {};
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN_KEYS.test(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) clean[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) clean[k] = v.slice(0, 50);
  }
  const text = JSON.stringify(clean);
  return text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL) : text;
}

// Fire-and-forget safe: a failed audit write is logged to the Worker console,
// never surfaced to the client and never allowed to fail the action itself.
export async function audit(env, { actor, action, targetType = null, targetId = null, detail = null }) {
  try {
    await env.DB
      .prepare('INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(actor ? actor.id : 'system', actor ? actor.role : 'system', action, targetType, targetId, sanitizeDetail(detail))
      .run();
  } catch (err) {
    console.error('audit write failed', action, err && err.message);
  }
}

export async function listAudit(env, { limit = 100, before = null } = {}) {
  const n = Math.max(1, Math.min(500, limit | 0));
  const sql = before
    ? 'SELECT id, at, actor_id, actor_role, action, target_type, target_id, detail FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?'
    : 'SELECT id, at, actor_id, actor_role, action, target_type, target_id, detail FROM audit_log ORDER BY id DESC LIMIT ?';
  const stmt = before ? env.DB.prepare(sql).bind(before, n) : env.DB.prepare(sql).bind(n);
  const { results } = await stmt.all();
  return results.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}
