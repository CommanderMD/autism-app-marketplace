import { json, readJson } from '../http.js';
import { hashPassword, verifyPassword, getDummyHash } from '../auth/password.js';
import {
  createSession, deleteSession, getSessionId, sessionCookie, clearSessionCookie
} from '../auth/session.js';
import { getCurrentUser } from '../auth/middleware.js';
import { checkInvite } from './school.js';

// platform_admin is deliberately absent: it can never be self-registered.
const SELF_REGISTER_ROLES = ['parent', 'school_admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 1024;

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;
const FAILED_LOGIN_DELAY_MS = 1000;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, school_id: user.school_id ?? null };
}

export async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  const email = normalizeEmail(body.email);
  const { password, role } = body;
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: 'A valid email is required' }, 400);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return json({ error: `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` }, 400);
  }
  if (!SELF_REGISTER_ROLES.includes(role)) {
    return json({ error: "role must be 'parent' or 'school_admin'" }, 400);
  }

  // Optional invite: joins an existing school instead of creating one.
  let invite = null;
  if (body.invite_code !== undefined && body.invite_code !== null) {
    const checked = await checkInvite(env, body.invite_code, { role, email });
    if (checked.error) return json({ error: checked.error }, 400);
    invite = checked.invite;
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const statements = [];
  let schoolId = null;

  if (invite) {
    // The users insert is conditioned on the invite still being unused, and
    // the invite is marked used only if that insert happened, all in one
    // batch (one transaction). Two racing redeems cannot both succeed.
    schoolId = invite.school_id;
    statements.push(
      env.DB.prepare(`INSERT INTO users (id, email, password_hash, role, school_id)
                      SELECT ?, ?, ?, ?, school_id FROM school_invites
                      WHERE code = ? AND used_at IS NULL
                        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`)
        .bind(id, email, passwordHash, role, invite.code),
      env.DB.prepare(`UPDATE school_invites SET used_at = CURRENT_TIMESTAMP
                      WHERE code = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?)`)
        .bind(invite.code, id)
    );
  } else if (role === 'school_admin') {
    // A school_admin never chooses an existing school_id (that would let anyone
    // claim another school's children). Registration creates a new, empty school.
    schoolId = crypto.randomUUID();
    const schoolName = typeof body.school_name === 'string' && body.school_name.trim()
      ? body.school_name.trim().slice(0, 200)
      : 'Unnamed School';
    statements.push(
      env.DB.prepare('INSERT INTO schools (id, name, contact_email) VALUES (?, ?, ?)')
        .bind(schoolId, schoolName, email)
    );
  }

  if (!invite) {
    statements.push(
      env.DB.prepare('INSERT INTO users (id, email, password_hash, role, school_id) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, passwordHash, role, schoolId)
    );
  }

  if (role === 'parent') {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null;
    statements.push(
      env.DB.prepare('INSERT INTO parents (id, name, email) VALUES (?, ?, ?)').bind(id, name, email)
    );
  }

  try {
    const results = await env.DB.batch(statements);
    // Invite lost a race (used or expired since checkInvite). For a parent the
    // parents insert already failed its FK and rolled the batch back; for a
    // school_admin nothing was written.
    if (invite && results[0].meta.changes === 0) {
      return json({ error: 'Invite code has already been used' }, 400);
    }
  } catch (err) {
    const message = String(err && err.message);
    if (message.includes('UNIQUE')) {
      return json({ error: 'Email is already registered' }, 409);
    }
    if (invite && message.includes('FOREIGN KEY')) {
      return json({ error: 'Invite code has already been used' }, 400);
    }
    return json({ error: 'Internal error' }, 500);
  }

  return json(publicUser({ id, email, role, school_id: schoolId }), 201);
}

// Fixed-window counter in KV: ratelimit:login:<ip> -> {"count","windowStart"}.
// KV is eventually consistent and not atomic, so this is a best-effort limit.
async function checkLoginRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `ratelimit:login:${ip}`;
  const now = Date.now();
  let entry = await env.SESSIONS.get(key, 'json');
  if (!entry || now - entry.windowStart >= LOGIN_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }
  entry.count += 1;
  // 60s is the minimum KV TTL; the windowStart check above handles exact expiry.
  await env.SESSIONS.put(key, JSON.stringify(entry), { expirationTtl: 60 });
  if (entry.count > LOGIN_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000));
    return json({ error: 'Too many login attempts' }, 429, { 'Retry-After': String(retryAfter) });
  }
  return null;
}

export async function handleLogin(request, env) {
  const limited = await checkLoginRateLimit(request, env);
  if (limited) return limited;

  const body = await readJson(request);
  const email = normalizeEmail(body && body.email);
  const password = body && typeof body.password === 'string' ? body.password : '';

  const user = email
    ? await env.DB.prepare('SELECT id, email, password_hash, role, school_id FROM users WHERE email = ?')
        .bind(email).first()
    : null;

  // Always run PBKDF2, even for unknown emails, so timing does not reveal
  // whether an account exists.
  const ok = password.length > 0 && password.length <= MAX_PASSWORD &&
    await verifyPassword(password, user ? user.password_hash : await getDummyHash());

  if (!user || !ok) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return json({ error: 'Invalid email or password' }, 401);
  }

  const sessionId = await createSession(env, user);
  return json(publicUser(user), 200, { 'Set-Cookie': sessionCookie(sessionId) });
}

export async function handleLogout(request, env) {
  await deleteSession(env, getSessionId(request));
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function handleMe(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return json(publicUser(user));
}
