#!/usr/bin/env node
// Drives Act 1 end to end in a real browser against a running dev server and
// records it: register a fake parent, add a fake child, grant Act 1, open the
// gate URL, play Lesson 1 (with two deliberate misses to show "Try again" and
// the reveal), take the lesson reward, then open Lesson 2. Writes a .webm
// plus PNGs to docs/screenshots/phase4/. Never run against production.
//
//   node scripts/record-act1.mjs [http://127.0.0.1:8787]

import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8787';
if (/workers\.dev|techsmartinc\.com/.test(BASE)) {
  console.error('refusing to run against production');
  process.exit(1);
}
const OUT = 'docs/screenshots/phase4';
mkdirSync(OUT, { recursive: true });

const tag = Date.now().toString(36);
const email = `rec.${tag}@example.test`;
const password = 'correct-horse-battery';
const ACT1 = 'act1-sensory-learning';

// All setup calls run inside the browser so the __Host- session cookie (Secure)
// is set and sent by the page itself; localhost counts as a secure context.
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return JSON.parse(text);
  }, { method, path, body });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 760 },
  recordVideo: { dir: OUT, size: { width: 1100, height: 760 } },
  reducedMotion: 'no-preference',
});

const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await api(page, 'POST', '/auth/register', { email, password, role: 'parent' });
await api(page, 'POST', '/auth/login', { email, password });
const child = await api(page, 'POST', '/api/children', { name: 'Fake Child Rec' });
await api(page, 'POST', `/api/children/${child.id}/apps`, { app_id: ACT1 });

const log = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') log.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/apps/${ACT1}/play?child_id=${child.id}`);
await page.waitForSelector('.choice');
// A real gesture unlocks audio/speech for the session.
await page.mouse.click(10, 10);
await page.screenshot({ path: join(OUT, 'lesson1-step1.png') });

const timeline = [];
const t0 = Date.now();
const mark = (what) => timeline.push({ t: Date.now() - t0, what });

async function answerCurrentStep({ missFirst = false } = {}) {
  const prompt = (await page.textContent('#prompt')).trim();
  const target = prompt.match(/Tap the (\w+)\./)[1];
  const choices = await page.$$eval('.choice', (els) => els.map((e) => e.dataset.choice));
  if (missFirst) {
    const wrong = choices.find((c) => c !== target);
    await page.click(`.choice[data-choice="${wrong}"]`);
    await page.waitForFunction(() => document.querySelector('#feedback')?.textContent === 'Try again.');
    mark(`miss 1 on "${prompt}" -> Try again.`);
    await page.click(`.choice[data-choice="${wrong}"]`);
    await page.waitForSelector('.choice.is-correct-reveal');
    mark(`miss 2 -> reveal outline on "${target}"`);
    await page.screenshot({ path: join(OUT, 'lesson1-try-again-reveal.png') });
  }
  await page.click(`.choice[data-choice="${target}"]`);
  await page.waitForFunction(() => (document.querySelector('#feedback')?.textContent || '').startsWith('Yes!'));
  mark(`correct: ${target}`);
  // Next is enabled only after the task reward has played.
  await page.waitForSelector('.next:not([disabled])', { timeout: 5000 });
  const label = (await page.textContent('.next')).trim();
  await page.click('.next');
  mark(`pressed ${label}`);
}

const total = Number((await page.textContent('.progress span')).match(/of (\d+)/)[1]);
for (let i = 0; i < total; i++) {
  await answerCurrentStep({ missFirst: i === 1 });
  if (i === 3) await page.screenshot({ path: join(OUT, 'lesson1-mid.png') });
}
await page.waitForSelector('text=You did it!');
mark('lesson 1 complete panel');
await page.waitForTimeout(1300); // let the lesson reward play on camera
await page.screenshot({ path: join(OUT, 'lesson1-complete.png') });
await page.click('text=Next lesson');
await page.waitForFunction(() => /^Lesson 2:/.test(document.querySelector('.lesson-title')?.textContent || ''));
const title2 = (await page.textContent('.lesson-title')).trim();
mark(`now on: ${title2}`);
await page.screenshot({ path: join(OUT, 'lesson2-step1.png') });

// Settings panel, for the adult.
await page.click('button[aria-label="Settings for grown-ups"]');
await page.waitForSelector('.settings-panel:not([hidden])');
const safeChecked = await page.isChecked('#set-safe');
await page.screenshot({ path: join(OUT, 'settings-panel.png') });
mark(`settings panel open; safe mode checked = ${safeChecked}`);
await page.click('.settings-panel >> text=Close');

// Server-side truth: progress rows and today's usage.
const progress = await api(page, 'GET', `/api/children/${child.id}/progress?app_id=${ACT1}`);
const settings = await api(page, 'GET', `/api/children/${child.id}/settings?app_id=${ACT1}`);

await page.close();
await ctx.close();
await browser.close();

// Rename the video to a stable name.
const webm = readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.startsWith('act1-'));
if (webm) renameSync(join(OUT, webm), join(OUT, 'act1-lesson1-to-lesson2.webm'));

console.log(JSON.stringify({
  base: BASE,
  lesson2Title: title2,
  safeModeDefaultChecked: safeChecked,
  progress: { unlocked: progress.unlocked, lessons: progress.lessons },
  settingsIsDefault: settings.is_default,
  consoleWarningsOrErrors: log,
  timelineMs: timeline,
  video: existsSync(join(OUT, 'act1-lesson1-to-lesson2.webm')) ? 'act1-lesson1-to-lesson2.webm' : null,
}, null, 2));
