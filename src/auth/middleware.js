import { json } from '../http.js';
import { getSessionId, getSession } from './session.js';

// Loads the caller from the session cookie. Returns the user, or null.
// The user row is re-read from D1 so a deleted user or changed role/school
// takes effect immediately rather than when the session expires.
export async function getCurrentUser(request, env) {
  const sessionId = getSessionId(request);
  const session = await getSession(env, sessionId);
  if (!session || !session.userId) return null;
  const user = await env.DB
    .prepare('SELECT id, email, role, school_id FROM users WHERE id = ?')
    .bind(session.userId)
    .first();
  return user ? { ...user, sessionId } : null;
}

// requireAuth(...roles) -> async (request, env) => user | Response
// With no roles listed, any signed-in user passes.
// Usage: const user = await requireAuth('parent')(request, env);
//        if (user instanceof Response) return user;
export function requireAuth(...roles) {
  return async (request, env) => {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (roles.length > 0 && !roles.includes(user.role)) {
      return json({ error: 'Forbidden' }, 403);
    }
    return user;
  };
}
