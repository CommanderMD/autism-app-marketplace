const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

// Hands a UI request to the static asset layer. A missing binding is a
// deploy error and must say so; it never falls back to some other HTML.
export function serveAsset(env, request) {
  if (!env.ASSETS) return json({ error: 'Assets binding not configured' }, 500);
  return env.ASSETS.fetch(request);
}

// UTC calendar date, YYYY-MM-DD.
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
