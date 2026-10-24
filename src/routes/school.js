import { json, readJson } from '../http.js';
import { REACTIVATE_ON_CONFLICT } from './children.js';

const MAX_BULK_IDS = 500;
const INVITE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const INVITE_LENGTH = 8;
const INVITE_TTL = '+7 days';
const INVITE_ROLES = ['school_admin', 'parent'];
const INVITE_CODE_RE = /^[A-Z0-9]{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bulk grant one app to many children of the caller's school.
// The id list is passed to D1 as one JSON parameter (json_each), which avoids
// D1's 100-bound-parameter limit and keeps the school filter in SQL.
export async function handleBulkGrant(request, env, user) {
  if (!user.school_id) return json({ error: 'Your account is not linked to a school' }, 403);

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const appId = typeof body.app_id === 'string' ? body.app_id : '';
  if (!appId) return json({ error: 'app_id is required' }, 400);
  const ids = body.child_ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id)) {
    return json({ error: 'child_ids must be a non-empty array of strings' }, 400);
  }
  if (ids.length > MAX_BULK_IDS) return json({ error: `At most ${MAX_BULK_IDS} child_ids per request` }, 400);
  const childIds = [...new Set(ids)];
  const idsJson = JSON.stringify(childIds);

  const app = await env.DB.prepare('SELECT 1 AS found FROM apps WHERE id = ? AND is_active = 1').bind(appId).first();
  if (!app) return json({ error: 'App not found' }, 404);

  // All-or-nothing: count the ids that belong to this school. Ids from other
  // schools and ids that do not exist are indistinguishable to the caller.
  const owned = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM json_each(?) j JOIN children c ON c.id = j.value WHERE c.school_id = ?`)
    .bind(idsJson, user.school_id)
    .first();
  const rejected = childIds.length - owned.n;
  if (rejected > 0) {
    return json({ error: `${rejected} child_id(s) are not in your school; nothing was granted`, rejected }, 403);
  }

  // The insert re-applies the school filter, so even a concurrent change of a
  // child's school cannot grant outside it.
  const result = await env.DB
    .prepare(`INSERT INTO child_app_access (child_id, app_id, granted_by)
              SELECT c.id, ?, ? FROM json_each(?) j JOIN children c ON c.id = j.value WHERE c.school_id = ?
              ${REACTIVATE_ON_CONFLICT}`)
    .bind(appId, user.id, idsJson, user.school_id)
    .run();

  const granted = result.meta.changes;
  return json({ granted, already_granted: childIds.length - granted, app_id: appId });
}

// Uniform over A-Z0-9: bytes >= 252 (7 * 36) are rejected to avoid modulo bias.
function generateInviteCode() {
  let code = '';
  while (code.length < INVITE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 252 && code.length < INVITE_LENGTH) code += INVITE_ALPHABET[b % 36];
    }
  }
  return code;
}

export async function handleCreateInvite(request, env, user) {
  if (!user.school_id) return json({ error: 'Your account is not linked to a school' }, 403);

  // Body is optional; an empty POST creates a school_admin invite.
  const body = (await readJson(request)) || {};
  const role = body.role ?? 'school_admin';
  if (!INVITE_ROLES.includes(role)) return json({ error: "role must be 'school_admin' or 'parent'" }, 400);
  let email = null;
  if (body.email !== undefined && body.email !== null) {
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'email must be a valid address' }, 400);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    try {
      await env.DB
        .prepare(`INSERT INTO school_invites (code, school_id, email, role, created_by, expires_at)
                  VALUES (?, ?, ?, ?, ?, datetime('now', '${INVITE_TTL}'))`)
        .bind(code, user.school_id, email, role, user.id)
        .run();
    } catch (err) {
      if (String(err && err.message).includes('UNIQUE')) continue;
      return json({ error: 'Internal error' }, 500);
    }
    const invite = await env.DB.prepare('SELECT code, expires_at FROM school_invites WHERE code = ?').bind(code).first();
    return json(invite, 201);
  }
  return json({ error: 'Internal error' }, 500);
}

// Loads an invite for redemption. Returns { invite } or { error }.
// Only school_id and role are read: the inviter (created_by) and the bound
// email never leave this function.
export async function checkInvite(env, code, { role, email } = {}) {
  if (typeof code !== 'string' || !INVITE_CODE_RE.test(code)) return { error: 'Invalid invite code' };
  const invite = await env.DB
    .prepare(`SELECT code, school_id, role, expires_at,
                     used_at IS NOT NULL AS used,
                     (expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP) AS expired,
                     (email IS NULL OR email = ?) AS email_ok
              FROM school_invites WHERE code = ?`)
    .bind(email ?? '', code)
    .first();
  if (!invite) return { error: 'Invalid invite code' };
  if (invite.used) return { error: 'Invite code has already been used' };
  if (invite.expired) return { error: 'Invite code has expired' };
  if (role !== undefined && invite.role !== role) return { error: `Invite code is for role '${invite.role}'` };
  if (email !== undefined && !invite.email_ok) return { error: 'Invite code is not valid for this email' };
  return { invite: { code: invite.code, school_id: invite.school_id, role: invite.role, expires_at: invite.expires_at } };
}

// Public pre-check used by the registration form. It does NOT consume the code;
// the code is consumed atomically by /auth/register with invite_code.
export async function handleRedeemInvite(request, env, code) {
  const { invite, error } = await checkInvite(env, code);
  if (error) return json({ error }, 400);
  return json({ code: invite.code, valid: true, role: invite.role, expires_at: invite.expires_at });
}
