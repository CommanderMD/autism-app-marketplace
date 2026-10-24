import { checkHealth } from './db.js';
import { json, serveAsset } from './http.js';
import { handleGetApps, handleGetAppById } from './routes/apps.js';
import { handleRegister, handleLogin, handleLogout, handleMe } from './routes/auth.js';
import {
  handleCreateChild, handleListChildren, handleGetChild, handleListChildApps, handleGrantApp, handleRevokeApp
} from './routes/children.js';
import { handleUsageSummary, handleUsageCsv } from './routes/usage.js';
import { handleGetSettings, handlePutSettings } from './routes/settings.js';
import { handlePostProgress, handleGetProgress } from './routes/progress.js';
import { handlePlay } from './routes/play.js';
import { handleBulkGrant, handleCreateInvite, handleRedeemInvite } from './routes/school.js';
import {
  handleAdminListApps, handleAdminCreateApp, handleAdminUpdateApp,
  handleAdminListSchools, handleAdminCreateSchool, handleAdminAssignSchool
} from './routes/admin.js';
import { requireAuth } from './auth/middleware.js';

const ALL_ROLES = ['parent', 'school_admin', 'platform_admin'];

// Module and stylesheet files under public/apps/act1/, plus the debug harness
// (dev.html; the asset layer's clean URL for it is /apps/act1/dev).
const ACT1_ASSET = /^\/apps\/act1\/(?:(?:engine|lessons|css|js)\/[a-z0-9][a-z0-9-]*\.(?:js|css)|dev(?:\.html)?)$/;

function methodNotAllowed(allowed) {
  return json({ error: 'Method Not Allowed' }, 405, { Allow: allowed });
}

function forbidden() {
  return json({ error: 'Forbidden' }, 403);
}

// wrangler.jsonc sets run_worker_first, so every request lands here.
// /api/*, /auth/*, /apps* and /health are JSON namespaces: an unmatched path
// inside them is a JSON 404 and never reaches the asset layer (whose SPA
// fallback would answer with index.html and a 200). The one HTML route inside
// them is the launch gate, GET /apps/:id/play; the only static files inside
// them are the Act 1 module assets (ACT1_ASSET). Everything else - /,
// /parent, /school, /admin, /app/:id, /login, /css/*, /js/*, deep links -
// is delegated to static assets.
export async function handle(request, env, ctx) {
  // An uncaught exception would become the platform's HTML error page; answer
  // with JSON instead and never send internals (messages, stacks) to the client.
  try {
    return await route(request, env);
  } catch (err) {
    if (err instanceof URIError) return json({ error: 'Malformed URL' }, 400);
    console.error('Unhandled error', err);
    return json({ error: 'Internal error' }, 500);
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/health') {
    const dbOk = await checkHealth(env.DB);
    return json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503);
  }

  // Public catalogue: no child data.
  if (path === '/apps') {
    return handleGetApps(request, env);
  }

  const appMatch = path.match(/^\/apps\/([^/]+)$/);
  if (appMatch) {
    return handleGetAppById(request, env, decodeURIComponent(appMatch[1]));
  }

  // Launch gate: an HTML page, so it must be matched before the JSON 404
  // below claims everything else under /apps/.
  const playMatch = path.match(/^\/apps\/([^/]+)\/play$/);
  if (playMatch) {
    if (method !== 'GET') return methodNotAllowed('GET');
    return handlePlay(request, env, decodeURIComponent(playMatch[1]));
  }

  // The Act 1 app's own assets (engine, lessons, css, js). Served as static files,
  // never through the launch gate: the gate is the entry point, not a file server.
  // Deliberately an allowlist, not "/apps/act1/*": the shell (/apps/act1/) and the
  // denial page stay JSON 404 here, so they are only ever served by handlePlay,
  // which reads them from env.ASSETS directly. The pattern admits no '%', so an
  // encoded path cannot reach them either. act1 only - no other app id.
  if (ACT1_ASSET.test(path)) {
    return serveAsset(env, request);
  }

  if (path.startsWith('/apps/')) {
    return json({ error: 'Not Found' }, 404);
  }

  if (path === '/auth' || path.startsWith('/auth/')) {
    return handleAuth(request, env, path, method);
  }

  if (path === '/api' || path.startsWith('/api/')) {
    return handleApi(request, env, path, method);
  }

  return serveAsset(env, request);
}

async function handleAuth(request, env, path, method) {
  if (path === '/auth/register') {
    return method === 'POST' ? handleRegister(request, env) : methodNotAllowed('POST');
  }

  if (path === '/auth/login') {
    return method === 'POST' ? handleLogin(request, env) : methodNotAllowed('POST');
  }

  if (path === '/auth/logout') {
    return method === 'POST' ? handleLogout(request, env) : methodNotAllowed('POST');
  }

  if (path === '/auth/me') {
    return method === 'GET' ? handleMe(request, env) : methodNotAllowed('GET');
  }

  return json({ error: 'Not Found' }, 404);
}

async function handleApi(request, env, path, method) {
  // The only public /api routes. Both are matched exactly; anything else
  // under /api requires a session.
  if (path === '/api/status') {
    return method === 'GET'
      ? json({ name: 'Autism App Marketplace API', status: 'online' })
      : methodNotAllowed('GET');
  }

  const redeemMatch = path.match(/^\/api\/school\/invites\/([^/]+)\/redeem$/);
  if (redeemMatch) {
    if (method !== 'POST') return methodNotAllowed('POST');
    return handleRedeemInvite(request, env, decodeURIComponent(redeemMatch[1]));
  }

  // Everything else under /api/ requires a session, including unknown paths,
  // so probing /api/* without a cookie always gets 401.
  const user = await requireAuth(...ALL_ROLES)(request, env);
  if (user instanceof Response) return user;

  if (path === '/api/children') {
    if (method === 'GET') return handleListChildren(request, env, user);
    if (method === 'POST') return handleCreateChild(request, env, user);
    return methodNotAllowed('GET, POST');
  }

  const childAppMatch = path.match(/^\/api\/children\/([^/]+)\/apps\/([^/]+)$/);
  if (childAppMatch) {
    if (method !== 'DELETE') return methodNotAllowed('DELETE');
    return handleRevokeApp(request, env, user,
      decodeURIComponent(childAppMatch[1]), decodeURIComponent(childAppMatch[2]));
  }

  const childAppsMatch = path.match(/^\/api\/children\/([^/]+)\/apps$/);
  if (childAppsMatch) {
    const childId = decodeURIComponent(childAppsMatch[1]);
    if (method === 'GET') return handleListChildApps(request, env, user, childId);
    if (method === 'POST') return handleGrantApp(request, env, user, childId);
    return methodNotAllowed('GET, POST');
  }

  const settingsMatch = path.match(/^\/api\/children\/([^/]+)\/settings$/);
  if (settingsMatch) {
    const childId = decodeURIComponent(settingsMatch[1]);
    if (method === 'GET') return handleGetSettings(request, env, user, childId);
    if (method === 'PUT') return handlePutSettings(request, env, user, childId);
    return methodNotAllowed('GET, PUT');
  }

  const progressMatch = path.match(/^\/api\/children\/([^/]+)\/progress$/);
  if (progressMatch) {
    if (method !== 'GET') return methodNotAllowed('GET');
    return handleGetProgress(request, env, user, decodeURIComponent(progressMatch[1]));
  }

  if (path === '/api/progress') {
    if (method !== 'POST') return methodNotAllowed('POST');
    return handlePostProgress(request, env, user);
  }

  const childMatch = path.match(/^\/api\/children\/([^/]+)$/);
  if (childMatch) {
    if (method !== 'GET') return methodNotAllowed('GET');
    return handleGetChild(request, env, user, decodeURIComponent(childMatch[1]));
  }

  if (path === '/api/usage/summary') {
    if (method !== 'GET') return methodNotAllowed('GET');
    return handleUsageSummary(request, env, user);
  }

  if (path.startsWith('/api/school/')) {
    if (user.role !== 'school_admin') return forbidden();

    if (path === '/api/school/children/apps') {
      return method === 'POST' ? handleBulkGrant(request, env, user) : methodNotAllowed('POST');
    }
    if (path === '/api/school/usage.csv') {
      return method === 'GET' ? handleUsageCsv(request, env, user) : methodNotAllowed('GET');
    }
    if (path === '/api/school/invites') {
      return method === 'POST' ? handleCreateInvite(request, env, user) : methodNotAllowed('POST');
    }
    return json({ error: 'Not Found' }, 404);
  }

  if (path.startsWith('/api/admin/')) {
    if (user.role !== 'platform_admin') return forbidden();

    if (path === '/api/admin/apps') {
      if (method === 'GET') return handleAdminListApps(request, env);
      if (method === 'POST') return handleAdminCreateApp(request, env);
      return methodNotAllowed('GET, POST');
    }

    const adminAppMatch = path.match(/^\/api\/admin\/apps\/([^/]+)$/);
    if (adminAppMatch) {
      if (method !== 'PATCH') return methodNotAllowed('PATCH');
      return handleAdminUpdateApp(request, env, decodeURIComponent(adminAppMatch[1]));
    }

    if (path === '/api/admin/schools') {
      if (method === 'GET') return handleAdminListSchools(request, env);
      if (method === 'POST') return handleAdminCreateSchool(request, env);
      return methodNotAllowed('GET, POST');
    }

    const userSchoolMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/school$/);
    if (userSchoolMatch) {
      if (method !== 'POST') return methodNotAllowed('POST');
      return handleAdminAssignSchool(request, env, decodeURIComponent(userSchoolMatch[1]));
    }

    return json({ error: 'Not Found' }, 404);
  }

  return json({ error: 'Not Found' }, 404);
}
