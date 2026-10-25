# Autism App Marketplace

A marketplace of learning and life-skills apps for autistic children, managed
by parents and schools, with the first app (**Act 1 — Sensory Learning**, a
ten-lesson curriculum) built in. Children never have accounts: adults sign in,
children play through a server-side launch gate.

Everything runs on Cloudflare: Workers (API + static assets), D1 (SQLite),
KV (sessions), a nightly cron. No third-party service is loaded by any page.

Live: `https://autism.techsmartinc.com` (see `docs/RUNBOOK.md` for the domain).

## Setup

```sh
git clone git@github.com:CommanderMD/autism-app-marketplace.git
cd autism-app-marketplace
npm install
npx wrangler@4 whoami          # must show the TechSmart account
```

`wrangler.jsonc` already names the production D1 database and KV namespace.
Nothing else needs configuring for local work; `wrangler dev --local` uses a
local D1 and KV under `.wrangler/`.

## Run locally

```sh
npm run migrate:local          # apply migrations/*.sql to the local D1 (safe to repeat)
npm run dev                    # http://localhost:8787
```

Use `localhost`, not `127.0.0.1`: the session cookie is `__Host-` / Secure and
localhost counts as a secure context.

Create a platform admin for the local database with
`node scripts/bootstrap-admin.mjs --local <email>` (see the script header).

## Test

```sh
npm test                       # vitest in workerd: 218 tests across 10 files
```

If `npm test` says `vitest: command not found`, the shell has
`NODE_ENV=production` exported and `npm install` skipped devDependencies.
Run `env -u NODE_ENV npm install --include=dev` once, then `npm test`.

Tests run the real Worker against an in-memory D1 with every migration
applied (`test/apply-migrations.js`). Fixtures are obviously fake
(`example.test` emails, "Fake Child …" names) — Rule A4.

Browser proofs (real Chromium via Playwright, against `wrangler dev`, never
production):

```sh
PLAYWRIGHT_PATH=<path to playwright> node scripts/record-act1.mjs   http://localhost:8787  # Phase 4 recording
PLAYWRIGHT_PATH=<path to playwright> node scripts/smoke-modes.mjs   http://localhost:8787  # drag / sequence / scenes
PLAYWRIGHT_PATH=<path to playwright> node scripts/offline-proof.mjs http://localhost:8787  # Phase 5: i18n, airplane mode, CSP
```

`node scripts/contrast.mjs` checks every colour pair in `public/css/app.css`
against WCAG AA.

## Deploy

```sh
npm run migrate:remote         # applies only migrations not yet in _migrations
npm run deploy                 # wrangler deploy; paste the version id in the PR
```

Pushes to `main` also deploy through Workers Builds. The cron trigger in
`wrangler.jsonc` (`15 3 * * *` UTC) is created by the same deploy.

Verify after every deploy:

```sh
curl -sI https://autism.techsmartinc.com/health | grep -iE "^(HTTP|x-empire-layer|content-security-policy)"
curl -s  https://autism.techsmartinc.com/api/status
```

## Migrate

Migrations are plain SQL in `migrations/`, applied in filename order by
`scripts/migrate.mjs`, which records each file in `_migrations` after it
succeeds and skips anything already recorded. **Never run `003`, `005` or
`006` by hand**: they contain unguarded `ALTER TABLE` and fail on a second
run (which is the intended signal that they were already applied).
`007`–`009` are idempotent.

| File | What |
|---|---|
| 001 | children, apps, child_app_access, app_usage, schools, parents |
| 002 | seed apps |
| 003 | users, roles, FKs (not idempotent) |
| 004 | `_migrations`, unique usage key, school_invites |
| 005 | child_settings, lesson_progress, seconds_used (ALTER) |
| 006 | scene, coloured_shapes (ALTER) |
| 007 | standards, app_standards + Act 1 goals |
| 008 | funding_sources, school_licenses |
| 009 | usage_daily, audit_log |

## Layout

```
src/            Worker: router, routes/, auth/, security.js, rollup.js, audit.js
public/         static assets: marketplace SPA (js/, css/), Act 1 app (apps/act1/),
                sprites and scenes (img/act1/), i18n/, sw.js
migrations/     D1 SQL, applied by scripts/migrate.mjs
scripts/        migrate, bootstrap-admin, contrast, browser proofs
test/           vitest (workers pool)
docs/           ARCHITECTURE, DATA_MODEL, RUNBOOK, BILLING, screenshots/, lessons/
```

More: `docs/ARCHITECTURE.md` (how a request flows, offline, i18n, security),
`docs/DATA_MODEL.md` (tables and ownership), `docs/RUNBOOK.md` (operations),
`docs/BILLING.md` (funding model and the payment plan).
