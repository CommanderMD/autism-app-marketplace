// Nightly usage rollup (migration 009), run by the scheduled handler in
// src/worker.js and, on demand, by POST /api/admin/usage/rollup.
//
// Rolls every app_usage row for a UTC day BEFORE today into usage_daily
// (upsert, so re-rolling corrects rather than duplicates). Today is never
// rolled: it is still being written to by POST /api/progress, so the summary
// reads today live and every earlier day from usage_daily.
//
// Default window is the last 3 closed days, which covers a missed night or
// two. `since` widens it (an admin backfill).

import { audit } from './audit.js';

export const DEFAULT_DAYS = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function rollupUsage(env, { since = null, actor = null } = {}) {
  const from = since && DATE_RE.test(since) ? since : null;
  const window = from
    ? "u.session_date >= ? AND u.session_date < date('now')"
    : `u.session_date >= date('now', '-${DEFAULT_DAYS} days') AND u.session_date < date('now')`;
  const params = from ? [from] : [];

  const result = await env.DB
    .prepare(`INSERT INTO usage_daily (child_id, app_id, day, seconds, minutes, activities, score, rolled_at)
              SELECT u.child_id, u.app_id, u.session_date,
                     COALESCE(u.seconds_used, 0), COALESCE(u.minutes_used, 0),
                     COALESCE(u.activities_completed, 0), u.score, CURRENT_TIMESTAMP
              FROM app_usage u WHERE ${window}
              ON CONFLICT (child_id, app_id, day) DO UPDATE SET
                seconds = excluded.seconds,
                minutes = excluded.minutes,
                activities = excluded.activities,
                score = excluded.score,
                rolled_at = CURRENT_TIMESTAMP`)
    .bind(...params)
    .run();

  const summary = { rows: result.meta.changes, since: from, days: from ? null : DEFAULT_DAYS };
  await audit(env, { actor, action: 'usage.rollup', targetType: 'usage', targetId: null, detail: summary });
  return summary;
}
