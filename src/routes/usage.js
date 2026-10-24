import { json, todayUtc } from '../http.js';
import { childScope, loadOwnedChild } from './children.js';

const SUMMARY_DAYS = 7;
// Last 7 days inclusive of today, UTC (SQLite date('now') is UTC).
const WINDOW = "u.session_date BETWEEN date('now', '-6 days') AND date('now')";
const CSV_MAX_ROWS = 10000;
const CSV_HEADER = ['child_name', 'app_name', 'session_date', 'minutes_used', 'activities_completed', 'score'];

// Every usage query filters rows through this subquery, so usage for a child
// outside the caller's scope is never read from D1, whatever the other filters say.
function scopedChildren(user, extraClause = '1 = 1', extraParams = []) {
  const scope = childScope(user);
  return {
    clause: `u.child_id IN (SELECT id FROM children WHERE ${extraClause} AND ${scope.clause})`,
    params: [...extraParams, ...scope.params],
  };
}

async function summarize(env, filter) {
  const where = `${filter.clause} AND ${WINDOW}`;
  const [totals, byApp, byDay] = await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(u.minutes_used), 0) AS minutes,
                           COALESCE(SUM(u.activities_completed), 0) AS activities
                    FROM app_usage u WHERE ${where}`).bind(...filter.params),
    env.DB.prepare(`SELECT u.app_id, a.name AS app_name,
                           SUM(u.minutes_used) AS minutes, SUM(u.activities_completed) AS activities
                    FROM app_usage u LEFT JOIN apps a ON a.id = u.app_id
                    WHERE ${where} GROUP BY u.app_id ORDER BY minutes DESC, u.app_id`).bind(...filter.params),
    env.DB.prepare(`SELECT u.session_date AS date,
                           SUM(u.minutes_used) AS minutes, SUM(u.activities_completed) AS activities
                    FROM app_usage u WHERE ${where} GROUP BY u.session_date ORDER BY u.session_date`).bind(...filter.params),
  ]);
  return {
    days: SUMMARY_DAYS,
    totals: totals.results[0],
    by_app: byApp.results,
    by_day: byDay.results,
  };
}

export async function handleUsageSummary(request, env, user) {
  const url = new URL(request.url);
  const childId = url.searchParams.get('child_id');
  const schoolId = url.searchParams.get('school_id');

  if (childId) {
    const child = await loadOwnedChild(env, user, childId);
    if (child instanceof Response) return child;
    const filter = scopedChildren(user, 'id = ?', [child.id]);
    return json({ scope: 'child', child_id: child.id, ...(await summarize(env, filter)) });
  }

  if (schoolId) {
    if (user.role === 'school_admin') {
      if (!user.school_id || user.school_id !== schoolId) return json({ error: 'Forbidden' }, 403);
    } else if (user.role === 'platform_admin') {
      const school = await env.DB.prepare('SELECT 1 AS found FROM schools WHERE id = ?').bind(schoolId).first();
      if (!school) return json({ error: 'School not found' }, 404);
    } else {
      return json({ error: 'Forbidden' }, 403);
    }

    const filter = scopedChildren(user, 'school_id = ?', [schoolId]);
    const summary = await summarize(env, filter);
    const { results: byChild } = await env.DB
      .prepare(`SELECT u.child_id, c.name AS child_name,
                       SUM(u.minutes_used) AS minutes, SUM(u.activities_completed) AS activities
                FROM app_usage u JOIN children c ON c.id = u.child_id
                WHERE ${filter.clause} AND ${WINDOW}
                GROUP BY u.child_id ORDER BY c.name, u.child_id`)
      .bind(...filter.params)
      .all();
    return json({ scope: 'school', school_id: schoolId, ...summary, by_child: byChild });
  }

  return json({ error: 'child_id or school_id is required' }, 400);
}

// RFC 4180: quote fields containing a comma, quote, CR or LF; double inner quotes.
// Text fields that start like a spreadsheet formula are prefixed with ' so a
// child or app name cannot run as a formula when the file is opened in Excel.
function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function handleUsageCsv(request, env, user) {
  if (!user.school_id) return json({ error: 'Your account is not linked to a school' }, 403);

  const filter = scopedChildren(user, 'school_id = ?', [user.school_id]);
  const { results } = await env.DB
    .prepare(`SELECT c.name AS child_name, a.name AS app_name, u.session_date,
                     u.minutes_used, u.activities_completed, u.score
              FROM app_usage u
              JOIN children c ON c.id = u.child_id
              LEFT JOIN apps a ON a.id = u.app_id
              WHERE ${filter.clause}
              ORDER BY u.session_date DESC, c.name, a.name
              LIMIT ${CSV_MAX_ROWS}`)
    .bind(...filter.params)
    .all();

  const lines = [CSV_HEADER.join(',')];
  for (const row of results) lines.push(CSV_HEADER.map((col) => csvField(row[col])).join(','));

  // The filename is a date only: no child or school names leave in headers.
  return new Response(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="usage-${todayUtc()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
