# Billing and funding model

No money moves in Phase 5. This document records the model that the schema
(`migrations/008_funding.sql`) and the grant path already enforce, and the
plan for taking payment later. No card data is ever stored in this system.

## Who pays for a seat

| Child | Funding | Enforced how |
|---|---|---|
| has a `school_id` | the school, through `school_licenses` | every grant (`POST /api/children/:id/apps`, bulk `POST /api/school/children/apps`) needs a **current** license for the app with a **free seat**, else `409 {code: "no_seats"}` |
| no `school_id` | the family (`self`) | no seat check; the parent is the payer |

A license is `(school_id, app_id, funding_source_id, seats, starts_at,
ends_at?)`. Licenses for the same (school, app) **pool**: seats are summed
across every license current today. Seats in use = live grants (active and
not expired) to the school's children for that app. Revoking a grant or
letting it expire frees the seat. A repeat grant to a child who already holds
a live grant takes no new seat.

Funding sources (`funding_sources`): `school` (own budget), `grant` (put the
grant name in `notes`), `district`, `self`.

Known limit: the seat check and the insert are two statements, so two grants
racing for the last seat can oversubscribe by one. `GET /api/school/licenses`
shows `pool.used` next to `pool.seats`, so an overage is visible. Accepted
for this phase.

## Endpoints

| Who | Call |
|---|---|
| platform_admin | `POST /api/admin/schools/:id/licenses` `{app_id, seats, starts_at?, ends_at?, funding_source_id?, notes?}` |
| platform_admin | `GET /api/admin/schools/:id/licenses`, `GET /api/admin/funding-sources` |
| school_admin | `GET /api/school/licenses` — own school, each row with `pool: {seats, used, free}` |

Every license creation is written to `audit_log` (`license.create`).

## Price list (proposal, not implemented)

| Plan | Price | Seats |
|---|---|---|
| Family | $7.99 / month or $69 / year per child | 1 |
| Classroom | $299 / year | 12 |
| School | $1,499 / year | 100 |
| District | quote | pooled across schools |

Act 1 is included in every plan. Later apps may be add-ons.

## Payment plan (Phase 6+)

**Schools and districts: invoice.** Most schools buy on a purchase order.
Flow: platform admin creates the license with `notes = PO number` and
`ends_at` = end of the school year, invoice goes out by email from the
TechSmart invoice template, the license is already live so onboarding is not
blocked on accounts payable. Non-payment → platform admin sets `ends_at` to
today; grants stop working at the next check. No code needed beyond what
exists.

**Families: Stripe Checkout + Customer Portal.** Add a `subscriptions` table
`(user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end)`
and a Worker route `POST /api/stripe/webhook` (signature-verified with a
`wrangler secret` `STRIPE_WEBHOOK_SECRET`). On `customer.subscription.*`
events update `status`. The grant path for a no-school child then checks
`status IN ('active','trialing')` the same way it checks seats for a school
child. Checkout and the portal are hosted by Stripe, so no card data touches
this Worker, and the CSP stays `connect-src 'self'` (the redirect is a
top-level navigation, not a fetch). Keys: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` as Worker secrets; the publishable key is not needed
with hosted Checkout.

**Grants (the funding kind).** Same as a school license with
`funding_source_id = 'grant'`; the grant's reporting usually wants usage per
child per month, which `usage_daily` already provides (CSV export is the
school's `/api/school/usage.csv`).

## What is deliberately not here

- No price or card field in any table.
- No automatic revocation when a license ends: the gate checks the grant,
  the grant path checks the license. A school whose license lapsed keeps
  existing grants until an admin revokes them or they expire; re-granting
  needs a current license. This is on purpose so a late PO never locks a
  child out mid-lesson.
