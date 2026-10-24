# Phase 3 lessons — dashboards and storefront UI

Written after PASS (96/100) and the squash-merge of PR #3 into `main` as `4d67b5d`.
Scope: Workers static assets routing, the storefront, the parent / school / platform-admin
dashboards, the usage and admin APIs, the migration runner, the admin bootstrap, and the
granted-apps endpoint added after the build report came back PARTIAL.

---

## 1. `assets.run_worker_first` is not a nicety — it is the difference between a 401 and a login page

With `not_found_handling: "single-page-application"`, the asset layer answers any path it
cannot match with `index.html` and HTTP **200**. A client calling `/api/children` without a
session would receive a login page with a success status instead of `401 {"error":"Unauthorized"}`.
That is not a cosmetic bug: every `fetch().ok` check in the UI becomes a lie, and a future
integration would parse HTML as JSON.

The fix is `run_worker_first: true` (`wrangler.jsonc:26`) plus a hard split in the router:
`/api` and `/auth` short-circuit to JSON before any asset call (`src/router.js:68`, `:72`),
and only the UI namespaces fall through to `env.ASSETS.fetch`.

**The lesson that matters:** I wrote `test/api-routing.test.js` before writing the code, because
the brief told me to. That test is the only reason this was caught. A post-hoc test written
after the routing existed would have asserted whatever the code already did.

Production proof, run after deploy — all seven API paths returned JSON, none returned HTML:

```
/api                      {"error":"Unauthorized"} | 401 application/json
/api/children             {"error":"Unauthorized"} | 401 application/json
/api/children/x/apps      {"error":"Unauthorized"} | 401 application/json
/api/usage/summary        {"error":"Unauthorized"} | 401 application/json
/api/does-not-exist       {"error":"Unauthorized"} | 401 application/json
```

## 2. A test that cannot fail is worse than no test

Before writing the routing assertions I probed the environment and found that the
`@cloudflare/vitest-pool-workers` pool does **not** expose `env.ASSETS` unless the binding is
declared in `wrangler.jsonc`. Worse, calling `worker.fetch` directly never exercises asset
precedence at all — the asset layer is only reached through the runtime, not through a
function call.

So a routing test written against a Worker with no `assets` block would have gone green while
the real trap stayed wide open. The order that worked: declare the binding, confirm the
binding appears in the test env, then write the assertion. **Probe the harness before
trusting the green.**

## 3. "PARTIAL" in a subagent's own report is data, not noise

The Phase 3B build reported honestly that the parent dashboard could grant and revoke apps
but could not list them — `GET /api/children/:id/apps` did not exist. The summary table still
read DONE for that item.

I grepped instead of trusting the table, found the gap, and it was real: the parent form
offered a blind "App to remove" select with no visibility into current access. I added the
endpoint (`src/routes/children.js:114`) and rebuilt that panel rather than shipping a
half-met item and calling it done.

**Rule:** read the deviation notes first, and verify every DONE claim with a command. A
builder's self-assessment is a lead, never a receipt.

## 4. Scope the query, not the view

Tenant isolation is only real if it lives in SQL. `handleListChildApps` routes through the
existing `loadOwnedChild` rather than re-implementing ownership checks, and expiry is decided
in the `WHERE` clause (`src/routes/children.js:109`) rather than filtered in JavaScript:

```sql
a.is_active = 1 AND (a.expires_at IS NULL OR datetime(a.expires_at) > CURRENT_TIMESTAMP)
```

Verified live, not assumed: a second parent received `[]` for their own list and `403` for
read, apps list and revoke against a child that was not theirs; an unknown child gave `404`.
A view that hides a row is not the same as a query that never returns it.

## 5. `curl`'s cookie jar hides HttpOnly cookies behind `#`

`curl -c` writes HttpOnly cookies with a `#HttpOnly_` prefix. A parser that skips lines
beginning with `#` (the obvious way to skip the jar's comment header) silently loses the
session cookie. This cost me a failed screenshot run with the unhelpful error
`no __Host-sid in /tmp/lp.txt`.

The fix is one condition: skip `#` **unless** the line starts with `#HttpOnly_`. Small, but
the class of bug is worth naming — comment-skipping logic applied to a file format where `#`
is also a data marker.

## 6. When you cannot see images, read the DOM

This model cannot view PNGs. A screenshot I cannot read is not evidence. So every dashboard
was verified by dumping `document.body.innerText` under a real session cookie and reading the
actual values:

- parent: two children, granted-apps table with per-row Remove, "28 min and 19 activities",
  by-app breakdown, 7-day bars, and "No apps granted yet." for the empty child
- school: Apps column `1,1,1,0`, then after a real click of "Grant to selected children",
  "Act 1 — Sensory Learning: granted to 2, already had it: 0" and those rows going `1→2`
- admin: `word-builder` rendering **Inactive** with an Activate button while four read **Active**

That text is stronger evidence than a picture would have been, because "28 min and 19
activities" cannot appear unless the API, the SQL scoping and the view all agree.

## 7. Clean up your own test data, and know what "clean" means

My live walkthrough created 5 children, 4 users, 1 school and 1 invite **in production**.
I deleted them by precise filter, then found two more: `parent.a@example.test` and
`parent.b@example.test` left over from the Phase 2 walkthrough, sitting in a production auth
table with a known test password. Removed those too.

Final verified state: `users 0, parents 0, children 0, schools 0, invites 0, apps 5, usage 0`.

**Lesson:** "the demo worked" is not the end of the task. The end is the state you leave
behind, and it must be measured after the cleanup, not assumed from the delete's success.

## 8. An idempotency claim needs a second run, not a careful reading

The migration runner was not called done until the second `npm run migrate:local` printed
`skipped` for all four files. The bootstrap note matters too: `_migrations` did not exist
before 004, and `003_auth.sql` is **not** idempotent — re-running it by hand would have
destroyed the auth tables. The runner detects "no `_migrations` table but `users` exists" and
backfills 001–003 as applied without re-executing them (`scripts/migrate.mjs:14-17`).

Same discipline for the unique usage key: the proof is
`UNIQUE constraint failed: app_usage.child_id, app_usage.app_id, app_usage.session_date`,
not "the schema has a UNIQUE keyword in it".

## 9. Carried into Phase 4

- **Expired grant must deny app launch.** `app_usage` has the unique key; `child_app_access`
  has `expires_at`. Phase 4 is where launch actually happens, so the denial test belongs
  there. Known edge today: a grant that is expired but still `is_active = 1` cannot be
  re-granted, because the grant path reactivates revoked grants only and never clears
  `expires_at`. Nothing in the API sets `expires_at` yet, so it needs a direct DB edit to hit.
- **No browser automation in the repo.** The UI is proven by served-file tests plus CDP/DOM
  inspection. A Playwright suite is a hardening item, not a Phase 3 deliverable.
- **`run_worker_first` applies to every future route.** Any new JSON namespace must be added
  to the router's short-circuit list, or the asset layer will answer it with HTML and a 200.
