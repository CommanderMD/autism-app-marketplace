#!/usr/bin/env node
// Phase 5 proof, in a real browser against a running dev server:
//   1. Spanish: switch the language on the storefront, check <html lang>,
//      the heading, the app-detail goals section, then Act 1 in Spanish.
//   2. Airplane mode: open Act 1 online (the service worker installs), go
//      offline (context.setOffline), reload - the lesson still loads from
//      the worker's caches - answer two steps offline (progress queues in
//      IndexedDB, the "Saved on this device" badge shows), go back online,
//      and check the queue drained into D1 via /api/children/:id/progress.
//   3. Security headers on the gate page and the API, and zero CSP
//      violations in the console for the whole run.
// Writes PNGs to docs/screenshots/phase5/. Never run against production.
//
//   PLAYWRIGHT_PATH=<path> node scripts/offline-proof.mjs [http://localhost:8787]

import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8787';
if (/workers\.dev|techsmartinc\.com/.test(BASE)) {
  console.error('refusing to run against production');
  process.exit(1);
}
const OUT = 'docs/screenshots/phase5';
mkdirSync(OUT, { recursive: true });

const tag = Date.now().toString(36);
const email = `p5.${tag}@example.test`;
const password = 'correct-horse-battery';
const ACT1 = 'act1-sensory-learning';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };

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
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'allow' });
const page = await ctx.newPage();
const console_ = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console_.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => console_.push(`pageerror: ${e.message}`));

// ---- setup: fake parent, fake child, grant
await page.goto(`${BASE}/`);
await api(page, 'POST', '/auth/register', { email, password, role: 'parent' });
await api(page, 'POST', '/auth/login', { email, password });
const child = await api(page, 'POST', '/api/children', { name: 'Fake Child Offline' });
await api(page, 'POST', `/api/children/${child.id}/apps`, { app_id: ACT1 });

// ---- 3a. headers
const headRes = await page.request.get(`${BASE}/api/status`);
const h = headRes.headers();
check('API carries Kemet-OS headers', h['x-empire-layer'] === 'Kemet-OS-Security-v1' && h['x-frame-options'] === 'DENY' && !!h['content-security-policy'], `x-empire-layer=${h['x-empire-layer']}`);
check('API is no-store', h['cache-control'] === 'no-store');

// ---- 1. Spanish on the storefront
await page.goto(`${BASE}/`);
await page.waitForSelector('#lang-switch');
await page.screenshot({ path: join(OUT, 'storefront-en.png') });
await page.selectOption('#lang-switch', 'es');
await page.waitForSelector('html[lang="es"]', { timeout: 15000 });
await page.waitForFunction(() => /aprender/i.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 15000 });
const lang = await page.evaluate(() => document.documentElement.lang);
const h1 = await page.textContent('h1');
check('storefront switches to Spanish (<html lang="es">, heading)', lang === 'es' && /aprender/i.test(h1), `${lang} / ${h1}`);
await page.screenshot({ path: join(OUT, 'storefront-es.png') });

await page.goto(`${BASE}/app/${ACT1}`);
await page.waitForSelector('#goals-heading');
const goalsHeading = await page.textContent('#goals-heading');
const goalCount = await page.locator('.goal-list li').count();
check('app detail shows the 10 IEP goals, in Spanish heading', goalCount === 10 && /PEI/.test(goalsHeading), `${goalCount} goals, "${goalsHeading}"`);
await page.screenshot({ path: join(OUT, 'app-detail-goals-es.png'), fullPage: true });

// ---- 2. Act 1 online first (installs the service worker), in Spanish
const gate = `${BASE}/apps/${ACT1}/play?child_id=${child.id}`;
await page.goto(gate);
await page.waitForSelector('.choice');
const prompt = await page.textContent('#prompt');
check('Act 1 prompt is Spanish', /^Toca el /.test(prompt), prompt);
const gateHeaders = (await page.request.get(gate)).headers();
check('gate page carries CSP + X-Frame-Options', !!gateHeaders['content-security-policy'] && gateHeaders['x-frame-options'] === 'DENY');
await page.screenshot({ path: join(OUT, 'act1-es-online.png') });

// Wait for the service worker to be active and the precache to fill.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(async () => {
  const keys = await caches.keys();
  if (!keys.some((k) => k.endsWith('-precache'))) return false;
  const cache = await caches.open(keys.find((k) => k.endsWith('-precache')));
  return (await cache.keys()).length >= 40;
}, null, { timeout: 20000 });
const precached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const c = await caches.open(keys.find((k) => k.endsWith('-precache')));
  return (await c.keys()).length;
});
check('service worker precached the Act 1 files', precached >= 40, `${precached} entries`);
// The gate page itself is cached on this visit (network-first, kept).
await page.waitForFunction(async () => {
  const keys = await caches.keys();
  const rt = keys.find((k) => k.endsWith('-runtime'));
  if (!rt) return false;
  const c = await caches.open(rt);
  return (await c.keys()).some((r) => r.url.includes('/play?child_id='));
}, null, { timeout: 10000 });

// Answer step 1 online so there is a baseline row.
async function answerCurrent() {
  const promptText = await page.textContent('#prompt');
  const shape = promptText.replace(/^Toca (el|la) /, '').replace(/\.$/, '').trim();
  const es2en = { 'círculo': 'circle', 'cuadrado': 'square', 'triángulo': 'triangle', 'rectángulo': 'rectangle', 'estrella': 'star' };
  const id = es2en[shape] || shape;
  await page.click(`.choice[data-choice="${id}"]`);
  await page.waitForSelector('.next:not([disabled])', { timeout: 10000 });
  await page.click('.next');
  await page.waitForFunction((prev) => document.getElementById('prompt')?.textContent !== prev, promptText, { timeout: 5000 }).catch(() => {});
}
await answerCurrent();
await page.waitForTimeout(500);
const progressOnline = await api(page, 'GET', `/api/children/${child.id}/progress?app_id=${ACT1}`);
const stepOnline = progressOnline.lessons.find((l) => l.lesson_id === '01-shapes')?.step_index ?? -1;
check('one step reported online', stepOnline >= 0, `step_index ${stepOnline}`);

// ---- airplane mode
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.choice', { timeout: 15000 });
check('Act 1 reloads OFFLINE from the service worker caches', true);
await page.waitForSelector('.offline-badge', { timeout: 5000 });
const badge = await page.textContent('.offline-badge');
check('offline badge shown', /Sin conexión|Offline/.test(badge), badge);
await page.screenshot({ path: join(OUT, 'act1-offline-reloaded.png') });

await answerCurrent();
await answerCurrent();
await page.waitForTimeout(500);
const queued = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('act1-offline');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('progress')) { resolve(-1); return; }
    const r = db.transaction('progress').objectStore('progress').getAll();
    r.onsuccess = () => resolve(r.result);
  };
  req.onerror = () => resolve(-2);
}));
console.log('queued bodies:', JSON.stringify(Array.isArray(queued) ? queued.map((q) => q.body) : queued));
check('two offline answers queued in IndexedDB, body only', Array.isArray(queued) && queued.length === 2 && Object.keys(queued[0]).sort().join() === 'body,queued_at,seq' && !JSON.stringify(queued).includes('Fake Child'), `${Array.isArray(queued) ? queued.length : queued} rows`);
await page.screenshot({ path: join(OUT, 'act1-offline-queued.png') });

// ---- back online: the 'online' event flushes the queue, oldest first.
// The offline reload restarted Lesson 1 at the cached resume point (step 0),
// so the two queued bodies are step_index 0 and 1: the server row should end
// at step_index 1 with attempts 3 (one online, two flushed).
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
let progressAfter = null;
for (let i = 0; i < 30; i++) {
  progressAfter = await api(page, 'GET', `/api/children/${child.id}/progress?app_id=${ACT1}`);
  if ((progressAfter.lessons.find((l) => l.lesson_id === '01-shapes')?.attempts ?? 0) >= 3) break;
  await page.waitForTimeout(500);
}
const row = progressAfter.lessons.find((l) => l.lesson_id === '01-shapes') || {};
console.log('progress after:', JSON.stringify(progressAfter.lessons));
const left = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('act1-offline');
  req.onsuccess = () => { const r = req.result.transaction('progress').objectStore('progress').count(); r.onsuccess = () => resolve(r.result); };
}));
check('queue drained to D1 after reconnect', row.attempts === 3 && row.step_index === 1 && left === 0, `attempts ${row.attempts}, step_index ${row.step_index}, ${left} left in queue`);
await page.waitForFunction(() => !document.querySelector('.offline-badge'), null, { timeout: 5000 }).catch(() => {});
await page.screenshot({ path: join(OUT, 'act1-back-online.png') });

// ---- parent dashboard goals (back to English for the screenshot)
await page.goto(`${BASE}/parent`);
await page.waitForSelector('#lang-switch');
await page.selectOption('#lang-switch', 'en');
await page.waitForLoadState('load');
await page.waitForSelector('.goal-list', { timeout: 15000 });
const goalLis = await page.locator('.goal-list li').count();
const working = await page.locator('.tag.status-working').count();
check('parent dashboard shows goals with Lesson 1 "Working on it"', goalLis === 10 && working >= 1, `${goalLis} goals, ${working} working`);
await page.screenshot({ path: join(OUT, 'parent-goals.png'), fullPage: true });

// ---- console: no CSP violations, no errors
const csp = console_.filter((l) => /Content Security Policy|CSP/.test(l));
check('zero CSP violations in the console', csp.length === 0, csp.slice(0, 3).join(' | '));
const errors = console_.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).filter((l) => !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(l));
check('no page errors (offline fetch failures excluded)', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
writeFileSync(join(OUT, 'offline-proof.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results, console: console_ }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
