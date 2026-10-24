// Who am I, and where does my role live. The session is the HttpOnly cookie;
// nothing about the user is stored in localStorage or sessionStorage.
import { api, ApiError } from './api.js';

const DASHBOARDS = {
  parent: '/parent',
  school_admin: '/school',
  platform_admin: '/admin',
};

let mePromise = null;

// The signed-in user ({ id, email, role, school_id }) or null. One request per page load.
export function getMe() {
  if (!mePromise) {
    mePromise = api('/auth/me').catch((err) => {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    });
  }
  return mePromise;
}

export function dashboardFor(role) {
  return DASHBOARDS[role] || '/';
}

// Only a same-origin path is accepted as a redirect target. Anything else
// (absolute URL, protocol-relative //host, backslash tricks) falls back.
export function safeNext(next, fallback = '/') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  try {
    const url = new URL(next, location.origin);
    if (url.origin !== location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export function loginUrl(next) {
  return `/login?next=${encodeURIComponent(next)}`;
}

// Returns the user if the session has the role; otherwise navigates to the
// login page (with next set to the current path) and returns null.
export async function requireRole(role) {
  const user = await getMe();
  if (user && user.role === role) return user;
  location.replace(loginUrl(location.pathname + location.search));
  return null;
}

export async function signOut() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    mePromise = null;
    location.assign('/');
  }
}
