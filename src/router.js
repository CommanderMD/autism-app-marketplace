import { checkHealth } from './db.js';
import { handleGetApps, handleGetAppById } from './routes/apps.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    return json({ name: 'Autism App Marketplace API', status: 'online' });
  }

  if (path === '/health') {
    const dbOk = await checkHealth(env.DB);
    return json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503);
  }

  if (path === '/apps') {
    return handleGetApps(request, env);
  }

  const appMatch = path.match(/^\/apps\/([^/]+)$/);
  if (appMatch) {
    return handleGetAppById(request, env, decodeURIComponent(appMatch[1]));
  }

  return json({ error: 'Not Found' }, 404);
}
