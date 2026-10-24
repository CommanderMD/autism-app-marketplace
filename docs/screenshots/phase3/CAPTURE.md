# Phase 3 screenshots: how to capture

The four PNGs in this folder (`storefront.png`, `parent.png`, `school.png`,
`admin.png`) are **not** produced by the build. Three of them need a signed-in
session against a running deployment with real accounts, which the build
environment cannot create. An operator captures them by hand after deploy.

## Ground rules

- Capture from a **non-production** deployment (a preview deploy, or
  `npm run dev` against the local D1 database). Do not create test children or
  usage rows in the production database to make a screenshot look full.
- Create the accounts through the UI (`/login?mode=register`). The
  `platform_admin` account comes from `scripts/bootstrap-admin.mjs`; it cannot be
  self-registered.
- Use made-up child names such as "Test Child A". Never capture a real child's name.
- The API has no endpoint that writes usage rows, so a fresh environment shows
  the honest empty state ("No usage in the last 7 days yet."). That is an
  acceptable screenshot. If populated bars are wanted, insert rows into the
  **local** D1 only (`wrangler d1 execute --local`) and say so in the PR.

## Browser setup (all shots)

- Desktop Chrome, Firefox or Safari, zoom 100%, light mode, no extensions that
  inject UI.
- Viewport **1280 × 900** CSS px. In Chrome DevTools: Toggle device toolbar →
  Responsive → 1280 × 900, then "Capture screenshot" from the device toolbar
  menu (captures the viewport, not the full page).
- Hide the DevTools pane from the shot itself.

## 1. `storefront.png`

- URL: `/` (signed out).
- Must be visible: the header with "Apps" and "Sign in", the h1 "Apps for
  learning and life skills", the category filter row with **All** pressed, and
  at least the first row of app cards, each with name, category, age range,
  description and a "View details" button.
- Optional second check (not saved): `/?category=finance` shows only the finance
  card with "finance" pressed, and the status line reads "Showing 1 app in finance."

## 2. `parent.png`

- Sign in as a `parent` with at least two children (added via the
  "Add a child" form; one with a birth date, one without).
- URL: `/parent`.
- Must be visible: the header with "Dashboard" and "Sign out", the "Add a child"
  form, and at least one child card showing the name, "Birth date" (a date or
  "not set"), the "Last 7 days" usage block (bars, or the empty-state sentence),
  and the "Give an app" control.

## 3. `school.png`

- Sign in as a `school_admin` whose school has at least three children on the
  roster.
- URL: `/school`.
- Before capturing: tick two children, pick an app, press "Grant to selected
  children", so the status line shows "…: granted to N, already had it: M."
- Must be visible: the roster with "Select all" and checkboxes, the app select
  and Grant button with the status line, and the top of the "Usage, last 7 days"
  table with its column headers.

## 4. `admin.png`

- Sign in as the `platform_admin`.
- Before capturing: deactivate one app (confirm the dialog) so the table shows
  both states.
- URL: `/admin`.
- Must be visible: the "All apps, including inactive" table with at least one
  **Active** row and one **Inactive** row (shaded, with the red "Inactive" badge
  and an "Activate" button), and the top of the "Create an app" form.
- Afterwards, re-activate the app.

## After capture

Save the files with exactly these names into `docs/screenshots/phase3/`, check
each one for real personal data (emails, real child names) before committing,
and commit them on the phase 3 branch.
