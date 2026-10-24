// Sessions live in the SESSIONS KV namespace, never in D1.
// KV key: session:<id>   value: {"userId","role","createdAt"}   TTL: 7 days

export const SESSION_TTL = 604800;
export const COOKIE_NAME = '__Host-sid';

const SESSION_ID_RE = /^[0-9a-f]{64}$/;

function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getSessionId(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      return SESSION_ID_RE.test(value) ? value : null;
    }
  }
  return null;
}

export async function createSession(env, user) {
  const id = newSessionId();
  const value = { userId: user.id, role: user.role, createdAt: Date.now() };
  await env.SESSIONS.put(`session:${id}`, JSON.stringify(value), { expirationTtl: SESSION_TTL });
  return id;
}

export async function getSession(env, id) {
  if (!id) return null;
  return env.SESSIONS.get(`session:${id}`, 'json');
}

export async function deleteSession(env, id) {
  if (id) await env.SESSIONS.delete(`session:${id}`);
}

export function sessionCookie(id) {
  return `${COOKIE_NAME}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
