import { json, readJson, todayUtc } from '../http.js';
import { isActiveApp } from '../db.js';
import { loadOwnedChild } from './children.js';

// Act 1 curriculum order. The unlock chain walks this list, never the order of
// rows returned from D1.
export const LESSON_ORDER = [
  '01-shapes', '02-numbers', '03-nouns', '04-verbs', '05-colors',
  '06-emotions', '07-opposites', '08-sequencing', '09-prepositions', '10-math',
];

const LESSON_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// The first lesson is always open. Each later lesson opens only when the one
// directly before it is completed; the first incomplete lesson ends the chain,
// so a completed lesson after a gap unlocks nothing.
export function computeUnlocked(lessons) {
  const done = new Set(lessons.filter((l) => l.completed).map((l) => l.lesson_id));
  const unlocked = [LESSON_ORDER[0]];
  for (let i = 1; i < LESSON_ORDER.length && done.has(LESSON_ORDER[i - 1]); i++) {
    unlocked.push(LESSON_ORDER[i]);
  }
  return unlocked;
}

const isIntIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// One POST is one micro-task completion: it adds to today's usage row and
// advances the lesson row, atomically, then reads both back from D1.
export async function handlePostProgress(request, env, user) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);

  if (typeof body.child_id !== 'string' || !body.child_id) {
    return json({ error: 'child_id is required' }, 400);
  }
  // Ownership first: a child the caller does not own is 403 before anything
  // about the rest of the body is considered, and nothing is written.
  const child = await loadOwnedChild(env, user, body.child_id);
  if (child instanceof Response) return child;

  const appId = body.app_id;
  if (typeof appId !== 'string' || !appId) return json({ error: 'app_id is required' }, 400);
  if (typeof body.lesson_id !== 'string' || !LESSON_ID_RE.test(body.lesson_id)) {
    return json({ error: 'lesson_id must match ^[a-z0-9][a-z0-9-]{0,39}$' }, 400);
  }
  if (!isIntIn(body.step_index, 0, 1000)) return json({ error: 'step_index must be an integer 0-1000' }, 400);
  const completed = body.completed ?? false;
  if (typeof completed !== 'boolean') return json({ error: 'completed must be a boolean' }, 400);
  const seconds = body.seconds ?? 0;
  if (!isIntIn(seconds, 0, 600)) return json({ error: 'seconds must be an integer 0-600' }, 400);
  const score = body.score ?? null;
  if (score !== null && !Number.isInteger(score)) return json({ error: 'score must be an integer' }, 400);
  if (!(await isActiveApp(env.DB, appId))) return json({ error: 'App not found' }, 404);

  const sessionDate = todayUtc();
  const lessonId = body.lesson_id;

  // In DO UPDATE SET, bare column names are the stored (pre-update) values, so
  // minutes_used is derived from the same accumulated total as seconds_used.
  const [, , usage, lesson] = await env.DB.batch([
    env.DB
      .prepare(`INSERT INTO app_usage
                  (child_id, app_id, session_date, seconds_used, minutes_used, activities_completed, score)
                VALUES (?, ?, ?, ?, CAST(? / 60 AS INTEGER), 1, ?)
                ON CONFLICT (child_id, app_id, session_date) DO UPDATE SET
                  seconds_used = seconds_used + excluded.seconds_used,
                  minutes_used = CAST((seconds_used + excluded.seconds_used) / 60 AS INTEGER),
                  activities_completed = activities_completed + 1,
                  score = COALESCE(excluded.score, score)`)
      .bind(child.id, appId, sessionDate, seconds, seconds, score),
    env.DB
      .prepare(`INSERT INTO lesson_progress (child_id, app_id, lesson_id, step_index, completed, attempts)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT (child_id, app_id, lesson_id) DO UPDATE SET
                  step_index = MAX(step_index, excluded.step_index),
                  attempts = attempts + 1,
                  completed = CASE WHEN excluded.completed = 1 THEN 1 ELSE completed END,
                  updated_at = CURRENT_TIMESTAMP`)
      .bind(child.id, appId, lessonId, body.step_index, completed ? 1 : 0),
    env.DB
      .prepare(`SELECT session_date, activities_completed, minutes_used FROM app_usage
                WHERE child_id = ? AND app_id = ? AND session_date = ?`)
      .bind(child.id, appId, sessionDate),
    env.DB
      .prepare(`SELECT lesson_id, step_index, completed FROM lesson_progress
                WHERE child_id = ? AND app_id = ? AND lesson_id = ?`)
      .bind(child.id, appId, lessonId),
  ]);

  const u = usage.results[0];
  const l = lesson.results[0];
  return json({
    ok: true,
    session_date: u.session_date,
    activities_completed: u.activities_completed,
    minutes_used: u.minutes_used,
    lesson: { lesson_id: l.lesson_id, step_index: l.step_index, completed: l.completed === 1 },
  });
}

export async function handleGetProgress(request, env, user, id) {
  const child = await loadOwnedChild(env, user, id);
  if (child instanceof Response) return child;

  const appId = new URL(request.url).searchParams.get('app_id');
  if (!appId) return json({ error: 'app_id is required' }, 400);
  if (!(await isActiveApp(env.DB, appId))) return json({ error: 'App not found' }, 404);

  const { results } = await env.DB
    .prepare(`SELECT lesson_id, step_index, completed, attempts FROM lesson_progress
              WHERE child_id = ? AND app_id = ? ORDER BY lesson_id`)
    .bind(child.id, appId)
    .all();
  const lessons = results.map((r) => ({ ...r, completed: r.completed === 1 }));
  return json({ child_id: child.id, app_id: appId, lessons, unlocked: computeUnlocked(lessons) });
}
