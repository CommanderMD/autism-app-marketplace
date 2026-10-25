import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Phase 5 client half: service worker, offline queue, i18n files, standards
// in the views. Asserted against the files the ASSETS binding really serves.

async function call(path) {
  const request = new Request(`http://example.com${path}`, { headers: { "CF-Connecting-IP": "203.0.113.60" } });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
const text = async (path) => (await call(path)).text();
const contentType = (res) => (res.headers.get("Content-Type") || "").toLowerCase();

const ACT1_FILES = [
  "/apps/act1/css/app.css", "/apps/act1/css/denied.css",
  "/apps/act1/js/shell.js", "/apps/act1/js/reward-player.js", "/apps/act1/js/settings-panel.js",
  "/apps/act1/js/svg-dom.js", "/apps/act1/js/companion.js", "/apps/act1/js/offline-queue.js",
  "/apps/act1/engine/lesson.js", "/apps/act1/engine/state.js", "/apps/act1/engine/reward.js", "/apps/act1/engine/svg.js",
  ...["01-shapes", "02-numbers", "03-nouns", "04-verbs", "05-colors", "06-emotions", "07-opposites", "08-sequencing", "09-prepositions", "10-math"]
    .map((l) => `/apps/act1/lessons/${l}.js`),
];
const SPRITES = ["robot-01-idle", "robot-02-blink", "robot-03-speak", "robot-04-point", "robot-05-listen", "robot-06-nod",
  "robot-07-happy", "robot-08-cheer", "robot-09-wave", "owl-01-idle", "owl-02-happy", "otter-01-idle", "otter-02-happy"]
  .map((f) => `/img/act1/${f}.png`);

describe("service worker", () => {
  it("1. /sw.js is served as JavaScript from the origin root and precaches every Act 1 file, sprite, scene and i18n file", async () => {
    const res = await call("/sw.js");
    expect(res.status).toBe(200);
    expect(contentType(res)).toContain("javascript");
    const sw = await res.text();
    for (const f of [...ACT1_FILES, ...SPRITES, "/img/act1/scene-solar.svg", "/img/act1/scene-jungle.svg", "/img/act1/scene-speedway.svg",
      "/i18n/en.json", "/i18n/es.json", "/js/api.js", "/js/ui.js", "/js/i18n.js"]) {
      expect(sw, f).toContain(`'${f}'`);
    }
    // Every precached path really exists.
    const listed = [...sw.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]).filter((p) => /^\/(apps|img|i18n|js)\//.test(p));
    for (const p of listed) expect((await call(p)).status, p).toBe(200);
  });

  it("2. the worker intercepts GET only, never caches a non-200, evicts on 401/403, and accepts only the 'warm' message", async () => {
    const sw = await text("/sw.js");
    expect(sw).toContain("if (req.method !== 'GET') return;");
    expect(sw).toContain("url.origin !== self.location.origin");
    expect(sw).toContain("if (res.ok)");
    expect(sw).toMatch(/res\.status === 401 \|\| res\.status === 403/);
    // One message kind. Sign-out clears caches from the page (session.js,
    // asserted in test 3), so there is no 'clear' branch to go stale here.
    expect(sw).toContain("data.type === 'warm' && Array.isArray(data.urls)");
    expect(sw).not.toContain("'clear'");
    expect(sw).toMatch(/credentials: 'include'/); // warm fetches carry the session cookie
    expect(sw).not.toMatch(/innerHTML|eval\(|importScripts/);
    // Only the gate page and the two boot GETs are network-first; nothing else under /api.
    expect(sw).toContain("/^\\/api\\/children\\/[^/]+\\/(settings|progress)$/");
    expect(sw).not.toContain("/api/children'");
  });

  it("3. the shell registers the worker, queues failed progress in IndexedDB and flushes on 'online'; sign-out forgets the device", async () => {
    const shell = await text("/apps/act1/js/shell.js");
    expect(shell).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(shell).toContain("from './offline-queue.js'");
    expect(shell).toContain("window.addEventListener('online'");
    expect(shell).not.toContain("setInterval");
    expect(shell).not.toContain("localStorage");
    const queue = await text("/apps/act1/js/offline-queue.js");
    expect(queue).toContain("const DB_NAME = 'act1-offline'");
    expect(queue).toContain("s.add({ body, queued_at: Date.now() })"); // the request body and a timestamp, nothing else
    expect(queue).not.toMatch(/child_name|email/i);
    const session = await text("/js/session.js");
    expect(session).toContain("caches.delete(k)");
    expect(session).toContain("indexedDB.deleteDatabase('act1-offline')");
  });
});

describe("i18n", () => {
  it("4. en.json and es.json are served as JSON, share the same keys, and es covers all of Lesson 1", async () => {
    const en = await call("/i18n/en.json");
    const es = await call("/i18n/es.json");
    expect(contentType(en)).toContain("json");
    expect(contentType(es)).toContain("json");
    const enJ = await en.json();
    const esJ = await es.json();
    const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = flat(enJ).filter((k) => !k.startsWith("lesson.")).sort();
    const esKeys = flat(esJ).filter((k) => !k.startsWith("lesson.")).sort();
    expect(esKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(100);
    for (const k of enKeys) expect(typeof flat(esJ).includes(k)).toBe("boolean");

    const lesson = await text("/apps/act1/lessons/01-shapes.js");
    const prompts = [...lesson.matchAll(/'(Touch [^']+)'/g)].map((m) => m[1]);
    const labels = [...lesson.matchAll(/cs\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[2]} ${m[1]}`);
    for (const s of [...new Set([...prompts, ...labels, "circle", "square", "triangle", "rectangle", "star", "Basic Shapes"])]) {
      expect(esJ.lesson[s], s).toBeTruthy();
    }
    expect(esJ.lesson["Touch the red circle."]).toBe("Toca el círculo rojo.");
  });

  it("5. the shells carry data-i18n hooks, the router sets <html lang>, and spoken audio follows the language", async () => {
    for (const page of ["/", "/login", "/parent", "/school", "/admin", "/app/x"]) {
      const html = await text(page);
      expect(html, page).toContain('data-i18n="common.sign_in"');
      expect(html, page).toContain('data-i18n="common.footer"');
    }
    const i18n = await text("/js/i18n.js");
    expect(i18n).toContain("document.documentElement.lang = current");
    expect(i18n).toContain("languageSwitcher");
    const router = await text("/js/router.js");
    expect(router).toContain("initI18n()");
    expect(router).toContain("translateStatic()");
    expect(router).toContain("languageSwitcher()");
    const shell = await text("/apps/act1/js/shell.js");
    expect(shell).toContain("u.lang = speechLang()");
    expect(shell).not.toContain("'en-US'");
    expect(shell).toContain("speech.speak(tr(view.audio))");
    const panel = await text("/apps/act1/js/settings-panel.js");
    expect(panel).toContain("languageSwitcher({ visible: true })");
    const storefront = await text("/js/views/storefront.js");
    expect(storefront).not.toContain("'Apps for learning and life skills'");
    expect(storefront).toContain("t('storefront.heading')");
  });
});

describe("standards in the views", () => {
  it("6. app detail lists the public standards; the parent dashboard shows goal status per child", async () => {
    const detail = await text("/js/views/app-detail.js");
    expect(detail).toContain("/standards`");
    expect(detail).toContain("goalsSection");
    const parent = await text("/js/views/parent.js");
    expect(parent).toContain("/goals?app_id=");
    expect(parent).toContain("goalsList");
    const css = await text("/css/app.css");
    expect(css).toContain(".goal-list");
    expect(css).toContain(".tag.status-met");
  });
});
