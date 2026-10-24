import { getApps, getAppById } from '../db.js';

export async function handleGetApps(request, env) {
  try {
    const apps = await getApps(env.DB);
    return new Response(JSON.stringify(apps), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleGetAppById(request, env, id) {
  try {
    const app = await getAppById(env.DB, id);
    if (!app) {
      return new Response(JSON.stringify({ error: 'App not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(app), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
