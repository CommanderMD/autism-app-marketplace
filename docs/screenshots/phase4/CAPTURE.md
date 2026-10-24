# Phase 4 screenshots and recording: how they were captured

Everything in this folder was produced by `scripts/record-act1.mjs` and
`scripts/smoke-modes.mjs` against a local `wrangler dev` server with a local
D1 (`npm run migrate:local`), using a fake parent and a fake child created for
the run. Nothing was captured against production and no test rows were
written there.

- `act1-lesson1-to-lesson2.webm` — Lesson 1 played end to end: two deliberate
  misses on step 2 ("Try again." then the reveal outline), the task reward on
  each correct answer, "You did it!" with the lesson reward, then "Next
  lesson" opening Lesson 2. Safe mode was ON (the default) for the whole run,
  so every reward is the gentle plan: no flashes, no full-screen change.
- `lesson1-step1.png`, `lesson1-try-again-reveal.png`, `lesson1-mid.png`,
  `lesson1-complete.png`, `lesson2-step1.png` — frames from that run.
- `settings-panel.png` — the grown-ups' panel, safe mode checked by default.
- `lesson2-drag.png` — drag mode (tap-to-place for two stars, a real pointer
  drag for the third), after a wrong count had shown "Try again."
- `lesson8-sequence.png` — sequence mode after "Start over", correct order
  filled in.

To reproduce:

```sh
npm run migrate:local
npx wrangler@4 dev --port 8787 --local
PLAYWRIGHT_PATH=<path to playwright> node scripts/record-act1.mjs http://localhost:8787
PLAYWRIGHT_PATH=<path to playwright> node scripts/smoke-modes.mjs http://localhost:8787
```

Both scripts refuse a `workers.dev` or `techsmartinc.com` base URL.
