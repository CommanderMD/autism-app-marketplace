# Phase 5 screenshots: how they were captured

Everything here was produced by `scripts/offline-proof.mjs` against a local
`wrangler dev` server with a local D1 (`npm run migrate:local`), using a fake
parent and a fake child created for the run. Nothing was captured against
production and no test rows were written there. The script's own pass/fail
log is in `offline-proof.json` (15/15).

- `storefront-en.png`, `storefront-es.png` — the language switcher in the
  header; after choosing Español the page reloads with `<html lang="es">`.
- `app-detail-goals-es.png` — the public "Objetivos de aprendizaje (PEI)"
  section on the Act 1 detail page: ten goals, one per lesson.
- `act1-es-online.png` — Act 1 in Spanish, online. The spoken prompt uses
  `es-ES` (SpeechSynthesis `lang` follows the UI language).
- `act1-offline-reloaded.png` — **airplane mode**: the browser context was
  set offline (`context.setOffline(true)`), the page reloaded, and the lesson
  loaded from the service worker's caches. The "Sin conexión" badge is next
  to the progress counter.
- `act1-offline-queued.png` — two steps answered offline; both POST bodies
  are waiting in IndexedDB (`act1-offline` / `progress`), bodies only.
- `act1-back-online.png` — after `setOffline(false)` the `online` event
  flushed the queue oldest-first; the server row shows attempts 3,
  step_index 1, queue empty.
- `parent-goals.png` — the parent dashboard's "Learning goals" list for the
  child: "Working on it · 3 attempts" on Lesson 1's goal.

To reproduce:

```sh
npm run migrate:local
npx wrangler@4 dev --port 8787 --local
PLAYWRIGHT_PATH=<path to playwright> node scripts/offline-proof.mjs http://localhost:8787
```

The script refuses a `workers.dev` or `techsmartinc.com` base URL.
