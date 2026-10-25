import { json } from '../http.js';
import { isActiveApp } from '../db.js';
import { getCurrentUser } from '../auth/middleware.js';
import { loadOwnedChild, GRANT_LIVE } from './children.js';

// Server-side launch gate for GET /apps/:appId/play?child_id=.
//
// The shell and the denial page live under /apps/act1/, a path the router
// answers with JSON 404, so they are only ever reachable through this handler.
// Asset paths are the asset layer's clean URLs: with the default html_handling,
// /apps/act1/index.html redirects to /apps/act1/ and denied.html to denied.
const SHELL_PATH = '/apps/act1/';
const DENIED_PATH = '/apps/act1/denied';

// no-store: the gate's answer depends on the session and on a grant that can
// expire. no-referrer: the page URL carries child_id; keep it out of Referer.
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

async function servePage(env, request, assetPath, status, childId) {
  if (!env.ASSETS) return json({ error: 'Assets binding not configured' }, 500);
  const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  if (!asset.ok) {
    console.error('Launch gate asset missing', assetPath, asset.status);
    return json({ error: 'Internal error' }, 500);
  }
  let page = new Response(asset.body, { status, headers: PAGE_HEADERS });
  // The child id reaches the page only through the shell's own
  // <meta name="child-id">; if the shell has no such tag, nothing is added.
  if (childId) {
    page = new HTMLRewriter()
      .on('meta[name="child-id"]', { element: (el) => el.setAttribute('content', childId) })
      .transform(page);
  }
  return page;
}

export async function handlePlay(request, env, appId) {
  if (!(await isActiveApp(env.DB, appId))) return json({ error: 'App not found' }, 404);

  const url = new URL(request.url);
  const user = await getCurrentUser(request, env);
  if (!user) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?next=${next}`, 'Cache-Control': 'no-store' },
    });
  }

  const childId = url.searchParams.get('child_id');
  if (!childId) return json({ error: 'child_id is required' }, 400);

  const child = await loadOwnedChild(env, user, childId);
  if (child instanceof Response) return child;

  // Same expiry semantics as the child's app list. Missing, revoked and expired
  // grants all get the same page, so the response never says which it was.
  const grant = await env.DB
    .prepare(`SELECT 1 AS live FROM child_app_access a WHERE a.child_id = ? AND a.app_id = ? AND ${GRANT_LIVE}`)
    .bind(child.id, appId)
    .first();
  if (!grant) return servePage(env, request, DENIED_PATH, 403, null);

  return servePage(env, request, SHELL_PATH, 200, child.id);
}
