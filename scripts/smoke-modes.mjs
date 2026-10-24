#!/usr/bin/env node
// Browser smoke test for the two non-tap modes: drag (Lesson 2, step 5) and
// sequence (Lesson 8). Uses the progress API to unlock, then plays the steps
// through the real shell. Dev server only; never production.
//   PLAYWRIGHT_PATH=... node scripts/smoke-modes.mjs http://localhost:8787
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE = process.argv[2] || 'http://localhost:8787';
if (/workers\.dev|techsmartinc\.com/.test(BASE)) { console.error('refusing production'); process.exit(1); }
const ACT1 = 'act1-sensory-learning';
const OUT = 'docs/screenshots/phase4';
const tag = Date.now().toString(36);

async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return JSON.parse(text);
  }, { method, path, body });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/`);
await api(page, 'POST', '/auth/register', { email: `modes.${tag}@example.test`, password: 'correct-horse-battery', role: 'parent' });
await api(page, 'POST', '/auth/login', { email: `modes.${tag}@example.test`, password: 'correct-horse-battery' });
const child = await api(page, 'POST', '/api/children', { name: 'Fake Child Modes' });
await api(page, 'POST', `/api/children/${child.id}/apps`, { app_id: ACT1 });

const results = {};

// ---- DRAG: complete lesson 1 so lesson 2 opens, then jump to step index 4.
await api(page, 'POST', '/api/progress', { child_id: child.id, app_id: ACT1, lesson_id: '01-shapes', step_index: 9, completed: true });
await api(page, 'POST', '/api/progress', { child_id: child.id, app_id: ACT1, lesson_id: '02-numbers', step_index: 4, completed: false });
await page.goto(`${BASE}/apps/${ACT1}/play?child_id=${child.id}`);
await page.waitForSelector('.drop-zone');
await page.mouse.click(10, 10);
results.dragPrompt = (await page.textContent('#prompt')).trim();
// Tap fallback: choose an item, tap the basket. Twice -> count 2 (wrong, target 3).
const items = await page.$$eval('.tray .drag-item', (els) => els.map((e) => e.dataset.choice));
await page.click(`.tray .drag-item[data-choice="${items[0]}"]`);
await page.click('.drop-zone');
await page.click(`.tray .drag-item[data-choice="${items[1]}"]`);
await page.click('.drop-zone');
await page.click('.next'); // "Check" with 2 placed
await page.waitForFunction(() => document.querySelector('#feedback')?.textContent === 'Try again.');
results.dragWrongCountFeedback = 'Try again.';
// Real pointer drag for the third item.
const third = await page.$(`.tray .drag-item[data-choice="${items[2]}"]`);
const zone = await page.$('.drop-zone');
const a = await third.boundingBox(); const z = await zone.boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForFunction(() => document.querySelectorAll('.drop-zone .placed .drag-item').length === 3);
await page.screenshot({ path: `${OUT}/lesson2-drag.png` });
await page.click('.next'); // Check with 3
await page.waitForFunction(() => document.querySelector('#feedback')?.textContent === 'Yes!');
results.dragCorrect = true;

// ---- SEQUENCE: complete lessons 2..7, open lesson 8.
for (const id of ['02-numbers', '03-nouns', '04-verbs', '05-colors', '06-emotions', '07-opposites']) {
  await api(page, 'POST', '/api/progress', { child_id: child.id, app_id: ACT1, lesson_id: id, step_index: 9, completed: true });
}
await page.goto(`${BASE}/apps/${ACT1}/play?child_id=${child.id}`);
await page.waitForSelector('.slots');
await page.mouse.click(10, 10);
results.sequencePrompt = (await page.textContent('#prompt')).trim();
results.sequenceTitle = (await page.textContent('.lesson-title')).trim();
const choices = await page.$$eval('.sequence-area .choice', (els) => els.map((e) => e.dataset.choice));
// Wrong order first: reversed.
for (const c of [...choices].reverse()) await page.click(`.sequence-area .choice[data-choice="${c}"]`);
await page.click('.next');
await page.waitForFunction(() => document.querySelector('#feedback')?.textContent === 'Try again.');
await page.click('text=Start over');
// The authored order for a sequence step is the lesson's answer; the shell is
// never told it, so read it from the module to drive the test honestly.
const answer = await page.evaluate(async () => {
  const mod = await import('/apps/act1/lessons/08-sequencing.js');
  return mod.default.steps[0].answer;
});
for (const c of answer) await page.click(`.sequence-area .choice[data-choice="${c}"]`);
await page.screenshot({ path: `${OUT}/lesson8-sequence.png` });
await page.click('.next');
await page.waitForFunction(() => document.querySelector('#feedback')?.textContent === 'Yes!');
results.sequenceCorrect = true;

results.errors = errors;
await browser.close();
console.log(JSON.stringify(results, null, 2));
