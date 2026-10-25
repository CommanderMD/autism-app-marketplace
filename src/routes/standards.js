import { json } from '../http.js';
import { isActiveApp } from '../db.js';
import { loadOwnedChild } from './children.js';

// IEP / standards tagging (migration 007).
//
// GET /apps/:id/standards is public: it describes the app, never a child.
// GET /api/children/:id/goals?app_id= is scoped: the same goals with the
// child's lesson progress folded in, so a parent or teacher can read
// "Identifies basic shapes - met" straight into an IEP review.

const STANDARD_COLUMNS = 's.id, s.domain, s.goal, s.description, s.code, a.lesson_id';

export async function appStandards(env, appId) {
  const { results } = await env.DB
    .prepare(`SELECT ${STANDARD_COLUMNS} FROM app_standards a JOIN standards s ON s.id = a.standard_id
              WHERE a.app_id = ? ORDER BY a.lesson_id, s.id`)
    .bind(appId)
    .all();
  return results.map((r) => ({ ...r, lesson_id: r.lesson_id === '' ? null : r.lesson_id }));
}

export async function handleAppStandards(request, env, appId) {
  const app = await env.DB.prepare('SELECT id FROM apps WHERE id = ?').bind(appId).first();
  if (!app) return json({ error: 'App not found' }, 404);
  return json({ app_id: appId, standards: await appStandards(env, appId) });
}

// status: 'met' (lesson completed), 'working' (started, not complete),
// 'not-started'. A whole-app goal (lesson_id null) is 'met' only when every
// lesson of the app is complete.
export async function handleChildGoals(request, env, user, childId) {
  const child = await loadOwnedChild(env, user, childId);
  if (child instanceof Response) return child;

  const appId = new URL(request.url).searchParams.get('app_id');
  if (!appId) return json({ error: 'app_id is required' }, 400);
  if (!(await isActiveApp(env.DB, appId))) return json({ error: 'App not found' }, 404);

  const [standards, progress] = await Promise.all([
    appStandards(env, appId),
    env.DB.prepare('SELECT lesson_id, step_index, completed, attempts, updated_at FROM lesson_progress WHERE child_id = ? AND app_id = ?')
      .bind(child.id, appId).all().then((r) => r.results),
  ]);
  const byLesson = new Map(progress.map((p) => [p.lesson_id, p]));
  const lessonIds = standards.map((s) => s.lesson_id).filter(Boolean);
  const allDone = lessonIds.length > 0 && lessonIds.every((id) => byLesson.get(id)?.completed === 1);

  const goals = standards.map((s) => {
    let status = 'not-started';
    let evidence = null;
    if (s.lesson_id) {
      const p = byLesson.get(s.lesson_id);
      if (p) {
        status = p.completed === 1 ? 'met' : 'working';
        evidence = { step_index: p.step_index, attempts: p.attempts, updated_at: p.updated_at };
      }
    } else if (allDone) {
      status = 'met';
    } else if (progress.length) {
      status = 'working';
    }
    return { ...s, status, evidence };
  });

  const met = goals.filter((g) => g.status === 'met').length;
  return json({ child_id: child.id, app_id: appId, met, total: goals.length, goals });
}
