# Runbook

Operations for `autism.techsmartinc.com`. Everything here is a Cloudflare
command (`wrangler`, the dashboard, or the API) or a `curl`. Account:
`c4546a4e98ef0b94f4e72a5fe91caf81`, Worker `autism-app-marketplace`, D1
`autism-app-marketplace-db` (`5d6310a8-…`), KV `SESSIONS` (`50e1713d…`).

Rule for every section: **production holds no test data.** Walkthroughs run
against `wrangler dev --local`. Check with:

```sh
npx wrangler@4 d1 execute autism-app-marketplace-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM children) children, (SELECT COUNT(*) FROM app_usage) usage"
```

## Deploy

```sh
git checkout main && git pull
npm test                                  # must be green
npm run migrate:remote                    # applies only unapplied migrations
npx wrangler@4 deploy                     # note the Version ID it prints
curl -sI https://autism.techsmartinc.com/health | grep -iE "^(HTTP|x-empire-layer)"
curl -s  https://autism.techsmartinc.com/api/status
```

Pushes to `main` also deploy through Workers Builds; a manual deploy is for
a hotfix or when Builds is paused. Migrations are **not** run by Builds:
always run `npm run migrate:remote` yourself before (or right after) the
deploy that needs them. New columns are additive, so the old build keeps
working during the gap.

## Roll back a deploy

```sh
npx wrangler@4 versions list                                  # find the previous version id
npx wrangler@4 versions deploy <previous-version-id>@100%     # or: dashboard → Worker → Deployments → Rollback
curl -sI https://autism.techsmartinc.com/health
```

Migrations are not rolled back: every migration since 004 is additive
(new tables/columns with defaults), so an older build runs against the newer
schema. If a rollback crosses a migration that the old code cannot tolerate,
restore D1 from Time Travel instead:

```sh
npx wrangler@4 d1 time-travel info    autism-app-marketplace-db
npx wrangler@4 d1 time-travel restore autism-app-marketplace-db --timestamp <ISO before the migration>
```

(Time Travel keeps 30 days.) Then delete the newer rows from `_migrations`
so the runner re-applies them later.

## Add a school

1. The school's first admin registers at `/login` → **Register** with role
   *school admin* and the **school name**. That creates the `schools` row and
   links the account to it (no platform-admin step needed). Alternatively a
   platform admin creates the school first (`/admin` → Create school, or
   `POST /api/admin/schools {"name","contact_email"}`) and links an existing
   school-admin account with `POST /api/admin/users/<user_id>/school
   {"school_id"}`.
2. Give the school seats — nothing can be granted to its children until a
   current license exists:
   ```sh
   curl -s -X POST https://autism.techsmartinc.com/api/admin/schools/<school_id>/licenses \
     -H "Cookie: $ADMIN_COOKIE" -H "Content-Type: application/json" \
     -d '{"app_id":"act1-sensory-learning","seats":30,"starts_at":"2026-08-01","ends_at":"2027-06-30","funding_source_id":"school","notes":"PO 12345"}'
   ```
   (`GET /api/admin/schools` lists ids.)
3. The school admin signs in → `/school` → creates invite codes for
   colleagues (`school_admin`) and families (`parent`), adds children and
   bulk-grants apps. The seat pool is visible through
   `GET /api/school/licenses` (`pool: {seats, used, free}` per app).

Every step above lands in `GET /api/admin/audit`.

## Add an app

1. `POST /api/admin/apps` `{id?, name, category, subcategory?, description?, age_min?, age_max?, difficulty_level?}`
   (id defaults to a slug of the name). `PATCH /api/admin/apps/:id` edits;
   `{"is_active": false}` retires it from the public catalogue.
2. Tag its IEP goals: insert into `standards` (if new goals) and
   `app_standards` with a migration (`migrations/0NN_<app>_standards.sql`,
   `INSERT OR IGNORE`), so every environment gets the same tags.
3. If the app is playable here, add its files under `public/apps/<id>/`,
   extend the asset allowlist in `src/router.js` (`ACT1_ASSET` is act1-only
   on purpose) and the gate's shell path in `src/routes/play.js`. The gate,
   the settings and the progress API are already per `app_id`.
4. Schools need a license per app: see *Add a school*, step 2.

## Rotate a secret

There are no application secrets today (sessions are random KV keys; password
hashes are PBKDF2 in D1). When one is added (the Stripe keys in
`docs/BILLING.md` are the first expected):

```sh
npx wrangler@4 secret put STRIPE_WEBHOOK_SECRET      # paste the new value; takes effect on the next deploy/version
npx wrangler@4 secret list
```

To rotate: create the new key at the provider, `secret put` it, deploy,
verify, then revoke the old key at the provider. Never put a secret in
`wrangler.jsonc`, `.dev.vars` committed to git, or a migration.

The Cloudflare API token used by Moby / scripts lives outside this repo
(TSV). Rotate it in the dashboard (My Profile → API Tokens → Roll) and
update the TSV; nothing in this repo references it.

To **invalidate every session** (suspected cookie theft): delete and
recreate the `SESSIONS` namespace, update its id in `wrangler.jsonc`,
deploy. Everyone signs in again.

## Custom domain `autism.techsmartinc.com`

The zone `techsmartinc.com` is on this account, so a Workers Custom Domain
does the DNS and the certificate in one step:

```sh
# wrangler.jsonc already carries:
#   "routes": [{ "pattern": "autism.techsmartinc.com", "custom_domain": true }]
npx wrangler@4 deploy
curl -I https://autism.techsmartinc.com/health
```

Dashboard equivalent: Worker → Settings → Domains & Routes → Add → Custom
Domain → `autism.techsmartinc.com`. The record is a proxied CNAME/Worker
record Cloudflare manages; do not create it by hand in DNS.

Security headers: the zone's Transform Rule **Kemet-OS Security Headers**
(expression `true`) already applies to every hostname in the zone, so the
subdomain inherits it; the Worker sets the same headers plus the CSP itself,
so `curl -sI` shows them on both the custom domain and workers.dev. If the
zone rule is ever disabled (kill switch), the Worker's copy still stands.

## Cron

`wrangler.jsonc` → `triggers.crons: ["15 3 * * *"]` (03:15 UTC). It runs
`scheduled()` in `src/worker.js` → `rollupUsage`. Check it ran: Worker →
Logs (observability is on) for `usage rollup`, or
`GET /api/admin/audit?limit=5` for an `actor_id: "system"`, `usage.rollup`
row. Missed nights: `POST /api/admin/usage/rollup?since=YYYY-MM-DD` as a
platform admin.

## Common checks

```sh
# headers
curl -sI https://autism.techsmartinc.com/ | grep -iE "x-frame-options|x-empire-layer|content-security-policy|strict-transport"
# gate without a session redirects to login
curl -sI "https://autism.techsmartinc.com/apps/act1-sensory-learning/play" | grep -iE "^(HTTP|location)"
# JSON namespaces never return HTML
curl -s https://autism.techsmartinc.com/api/nope
# cross-origin POST is refused
curl -s -X POST https://autism.techsmartinc.com/auth/login -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'
```

## Incident notes

- **Workers AI / gateway 504s do not affect this Worker**: it calls no model.
- A `FOREIGN KEY constraint failed` on `migrate:remote` means a migration
  was run out of order by hand; check `_migrations` before anything else.
- Service worker stuck on an old version in a browser: bump `VERSION` in
  `public/sw.js` and deploy; users get it on the next load (sign-out also
  clears every cache).
