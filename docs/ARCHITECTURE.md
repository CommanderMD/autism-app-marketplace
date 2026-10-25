# Architecture

One Cloudflare Worker serves everything: the JSON API, the launch gate, and
the static files. State lives in D1 (records) and KV (sessions). A cron
trigger runs the nightly usage rollup in the same Worker.

```
browser ──► Cloudflare edge (zone rules: Kemet-OS headers) ──► Worker (src/worker.js)
                                                                  │
                      ┌───────────────────────────────────────────┤
                      │ security.js: same-origin rule, headers     │
                      ▼                                           ▼
             router.js  ──► routes/*  ──► D1 (DB)           env.ASSETS (public/)
                        └──► auth/*   ──► KV (SESSIONS)
             scheduled() ──► rollup.js ──► D1 usage_daily
```

## Request flow

`wrangler.jsonc` sets `run_worker_first: true`, so every request enters
`src/router.js`. Decision (Phase 4 carry-forward): this stays `true` rather
than becoming a path list, because `security.js` must stamp headers and the
CSP on *every* response including static files, and because the asset layer
must never serve `/apps/act1/` directly (only the gate may). The cost is one
Worker invocation per static file, which is inside the free tier for this
traffic.

Namespaces:

| Path | Handled by | Notes |
|---|---|---|
| `/health`, `/api/status` | router | public |
| `/apps`, `/apps/:id`, `/apps/:id/standards` | routes/apps, routes/standards | public catalogue, no child data |
| `/apps/:id/play?child_id=` | routes/play | **launch gate**: session + grant check, HTMLRewriter injects the child id into `<meta name="child-id">`, 403 denial page otherwise |
| `/apps/act1/(engine\|lessons\|css\|js)/*` | asset allowlist | the only files under `/apps/` served statically |
| `/auth/*` | routes/auth | register, login (rate-limited), logout, me |
| `/api/*` | routes/* | everything else needs a session; role checked per route |
| anything else | `env.ASSETS` | SPA pages, `/sw.js`, `/i18n/*`, `/img/*` |

Unknown paths inside the JSON namespaces are JSON 404s and never fall through
to the SPA fallback. Uncaught errors become a JSON 500 with no internals.

## Security (Phase 5)

`src/security.js` wraps every response:

- Kemet-OS header set (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  HSTS preload, COOP, CORP, `X-Empire-Layer`) — the same set the
  `techsmartinc.com` zone applies at the edge, repeated here so workers.dev,
  local dev and the tests all see it.
- A Content-Security-Policy with **no `unsafe-inline`**: every script and
  stylesheet is a file on this origin; JS changes styles through the CSSOM.
  `test/phase5-api.test.js` greps `public/` for inline script/style.
- `Cache-Control: no-store` on `/api` and `/auth` unless a handler chose
  otherwise.
- Same-origin rule: a `POST/PUT/PATCH/DELETE` under `/api` or `/auth` with a
  foreign `Origin` or `Sec-Fetch-Site: cross-site` is refused (403) before any
  handler runs. There is no CORS allow list — nothing off-origin should call
  the API. This is also the CSRF guard for the cookie session.
- Secrets: none in the repo. Session cookies are `__Host-`, HttpOnly, Secure.
  Anything sensitive in future goes in `wrangler secret` (see RUNBOOK).
- Audit log (`audit_log`): admin and school-admin actions, ids and counts
  only (`src/audit.js` strips any key that looks like a name/email).

## Act 1 app

`public/apps/act1/` is a self-contained module set:

- `engine/` — pure: lesson contract (`defineLesson`, `renderStep`,
  `checkStep`), reducer (`state.js`, no timers), reward planner (`reward.js`,
  WCAG 2.3.1 flash budget, safe mode on by default), SVG library.
- `lessons/01..10` — data; the shell lazy-imports the current one.
- `js/shell.js` — the only DOM module; dispatches to the reducer and renders.
- `js/reward-player.js`, `js/settings-panel.js`, `js/companion.js` (Moby,
  Owla, Otter), `js/offline-queue.js`.

The child id reaches the shell only through the gate's meta tag. The shell
never stores it; the offline queue stores it only inside queued request
bodies, and sign-out deletes that store.

## Offline (Phase 5)

`public/sw.js` is registered by the shell at `/sw.js` (origin scope) but only
answers for Act 1:

| Request | Strategy |
|---|---|
| Act 1 files, sprites, scenes, i18n, shared `js/api.js`/`ui.js`/`i18n.js` | precached on install, cache-first |
| the gate page, `/api/children/:id/settings`, `/api/children/:id/progress` | network-first; last 200 kept per URL; 401/403/404 evicts |
| everything else, every non-GET | not intercepted |

On the first visit the page loads before the worker controls it, so the
shell posts `{type:'warm', urls}` and the worker fetches the gate page and
the two boot answers into the runtime cache with the session cookie.

Progress: `POST /api/progress` failures (network, 5xx) are queued in
IndexedDB (`act1-offline`), flushed oldest-first on `online`, one flush at a
time; a 4xx other than 401/429 drops the row. The topbar shows "Offline" or
"Saved on this device" while anything is queued. `scripts/offline-proof.mjs`
proves the loop in Chromium with `context.setOffline`.

`VERSION` in `sw.js` must change when a precached file changes; the old
caches are deleted on activate.

## i18n (Phase 5)

`public/i18n/<lang>.json` holds every UI string; `public/js/i18n.js` loads the
chosen language plus English and exposes `t(key, vars)` for UI strings and
`tr(sourceText)` for lesson text (keyed by the English source, so lesson
files stay plain English and a translation can be added one line at a time).
The choice is a device preference (`localStorage.lang`), set from the site
header or the grown-ups' panel, and reloads the page. `<html lang>` is set
on load; `SpeechSynthesisUtterance.lang` follows it. `es.json` has the same
key set as `en.json` (test-enforced) and covers the storefront, app detail,
router chrome, the Act 1 shell and panel, and all of Lesson 1.

## Analytics

`POST /api/progress` upserts today's `app_usage` row (seconds, activities)
and the lesson row. The cron (`15 3 * * *` UTC, `src/rollup.js`) copies every
closed day (`session_date < today`, default window 3 days) into `usage_daily`
with an upsert. `/api/usage/summary` reads `usage_daily` first and falls back
to `app_usage` only for a (child, app, day) with no rollup row — which is
today, and yesterday until the cron has run. `POST /api/admin/usage/rollup
?since=YYYY-MM-DD` backfills.

## Funding

See `docs/BILLING.md`. In one line: a child of a school takes a seat on one
of the school's `school_licenses` for the app (checked on every grant); a
child with no school is self-funded and never checked.

## Tests

`npm test` runs vitest inside workerd (`@cloudflare/vitest-pool-workers`)
with all migrations applied to an in-memory D1. Files: routing, auth, apps,
UI assets, phase3 API, phase4 API/engine/shell, phase5 API/client. 218 tests.
