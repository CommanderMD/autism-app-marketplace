import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { LADDERS, initialState, listView, ladderView, progressPayload } from "../public/apps/word-builder/engine/game.js";

// Word Builder shell, served through the real launch gate, plus the progress
// body the engine builds sent to the real API. All fixtures are obviously fake.
//
// The pool has no DOM, so "the list shows 8 ladders" and "a ladder shows 5
// rungs" are asserted on the descriptors js/main.js draws one-for-one
// (listView -> one tile each, ladderView.rungs -> one <li> each), and the
// served main.js is checked to draw from exactly those.

const PASSWORD = "correct-horse-battery";

async function call(method, path, { body, cookie, ip = "203.0.113.61" } = {}) {
  const headers = { "CF-Connecting-IP": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const request = new Request(`http://example.com${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual",
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

let ipCounter = 60;
async function parentWithWordBuilder(tag) {
  const email = `wb.${tag}@example.test`;
  expect((await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } })).status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const childRes = await call("POST", "/api/children", { cookie, body: { name: `Fake Child WB ${tag}` } });
  expect(childRes.status).toBe(201);
  const child = await childRes.json();
  expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: "word-builder" } })).status).toBe(201);
  return { cookie, child };
}

async function launch(tag) {
  const { cookie, child } = await parentWithWordBuilder(tag);
  const res = await call("GET", `/apps/word-builder/play?child_id=${child.id}`, { cookie });
  expect(res.status).toBe(200);
  return { cookie, child, html: await res.text() };
}

describe("Word Builder launch", () => {
  it("renders data-app-id=\"word-builder\" with the gate's app-id meta and a polite announcer", async () => {
    const { html, child } = await launch("appid");
    expect(html).toContain('data-app-id="word-builder"');
    expect(html).toContain('<meta name="app-id" content="word-builder">');
    expect(html).toContain(`<meta name="child-id" content="${child.id}">`);
    expect(html).toMatch(/id="announcer"[^>]*aria-live="polite"/);
    expect(html).toContain('src="/apps/word-builder/js/main.js"');
  });

  it("the ladder list shows 8 ladders, and a ladder opens with 5 rungs", async () => {
    const list = listView([]);
    expect(list).toHaveLength(8);
    expect(list.map((x) => x.id)).toEqual(LADDERS.map((l) => l.id));
    const view = ladderView(initialState(LADDERS[0], { hint: "ends", seed: 1 }));
    expect(view.rungs).toHaveLength(5);
    expect(view.bank).toHaveLength(8);

    const res = await call("GET", "/apps/word-builder/js/main.js");
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain("listView([...completed]).map(");
    expect(js).toContain("v.rungs.map(");
    expect(js).toContain("el('ol', { class: 'ladder-list' }, tiles)");
  });

  it("does not contain Act 1 lesson markup", async () => {
    const { html } = await launch("noact1");
    for (const marker of ["/apps/act1/", "act1", "lesson-title", 'class="choices"', "prompt-row", "progress-bar", "Sensory Learning"]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  it("main.js is the game, not the placeholder, and never names Act 1's app id", async () => {
    const js = await (await call("GET", "/apps/word-builder/js/main.js")).text();
    expect(js).not.toContain("placeholder");
    expect(js).not.toContain("act1-sensory-learning");
    expect(js).not.toMatch(/Math\.random/);
    expect(js).toContain("getAppId() !== APP_ID");
    // Tiles, not typing: no text inputs anywhere in the child's screens.
    expect(js).not.toMatch(/type: 'text'|<input|contenteditable/);
    for (const path of ["engine/game.js", "engine/ladders.js", "css/app.css"]) {
      const asset = await call("GET", `/apps/word-builder/${path}`);
      expect(asset.status, path).toBe(200);
    }
  });

  it("every colour pair the CSS documents meets 4.5:1", async () => {
    const css = await (await call("GET", "/apps/word-builder/css/app.css")).text();
    const root = css.match(/:root \{([^}]*)\}/)[1];
    const vars = Object.fromEntries([...root.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(vars[a]), lum(vars[b])].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const pairs = [["fg", "bg"], ["muted", "bg"], ["accent", "bg"], ["accent-text", "accent"],
      ["fg", "surface"], ["fg", "tile-used"], ["muted", "tile-used"], ["muted", "surface"], ["accent", "surface"]];
    for (const [a, b] of pairs) expect(ratio(a, b), `${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Word Builder progress", () => {
  it("the engine's payload is accepted and lands under word-builder, not Act 1", async () => {
    const { cookie, child } = await parentWithWordBuilder("progress");
    const rung = progressPayload({ childId: child.id, ladderId: "wb-01", step: 3, completed: false, seconds: 20 });
    expect(rung.app_id).toBe("word-builder");
    expect((await call("POST", "/api/progress", { cookie, body: rung })).status).toBe(200);
    const done = progressPayload({ childId: child.id, ladderId: "wb-01", step: 5, completed: true, seconds: 15 });
    const res = await call("POST", "/api/progress", { cookie, body: done });
    expect(res.status).toBe(200);
    expect((await res.json()).lesson).toEqual({ lesson_id: "wb-01", step_index: 5, completed: true });

    const mine = await (await call("GET", `/api/children/${child.id}/progress?app_id=word-builder`, { cookie })).json();
    expect(mine.lessons).toHaveLength(1);
    expect(mine.lessons[0]).toMatchObject({ lesson_id: "wb-01", step_index: 5 });
    expect(Boolean(mine.lessons[0].completed)).toBe(true);
    expect(listView(mine.lessons.filter((l) => l.completed).map((l) => l.lesson_id))[1].state).toBe("open");
    const act1 = await (await call("GET", `/api/children/${child.id}/progress?app_id=act1-sensory-learning`, { cookie })).json();
    expect(act1.lessons).toEqual([]);
  });
});
