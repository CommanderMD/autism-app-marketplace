import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { progressPayload } from "../public/apps/money-bingo/engine/bingo.js";

// Money Bingo shell, served through the real launch gate, plus the progress
// body the engine builds sent to the real API. All fixtures are obviously fake.

const PASSWORD = "correct-horse-battery";

async function call(method, path, { body, cookie, ip = "203.0.113.41" } = {}) {
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

let ipCounter = 40;
async function parentWithMoneyBingo(tag) {
  const email = `mb.${tag}@example.test`;
  expect((await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } })).status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const childRes = await call("POST", "/api/children", { cookie, body: { name: `Fake Child MB ${tag}` } });
  expect(childRes.status).toBe(201);
  const child = await childRes.json();
  expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: "money-bingo" } })).status).toBe(201);
  return { cookie, child };
}

async function launch(tag) {
  const { cookie, child } = await parentWithMoneyBingo(tag);
  const res = await call("GET", `/apps/money-bingo/play?child_id=${child.id}`, { cookie });
  expect(res.status).toBe(200);
  return { cookie, child, html: await res.text() };
}

describe("Money Bingo launch", () => {
  it("renders data-app-id=\"money-bingo\" and a 3x5 grid of 15 cells", async () => {
    const { html } = await launch("grid");
    expect(html).toContain('data-app-id="money-bingo"');
    expect(html).toContain('<meta name="app-id" content="money-bingo">');
    expect((html.match(/role="grid"/g) || []).length).toBe(1);
    expect((html.match(/role="row"/g) || []).length).toBe(3);
    expect((html.match(/role="gridcell"/g) || []).length).toBe(15);
    const cells = [...html.matchAll(/<button[^>]*class="cell"[^>]*data-cell="(\d+)"[^>]*aria-pressed="false"/g)].map((m) => Number(m[1]));
    expect(cells).toEqual([...Array(15).keys()]);
    // One polite announcer for calls and the win.
    expect(html).toMatch(/id="announcer"[^>]*aria-live="polite"/);
  });

  it("does not contain Act 1 lesson markup", async () => {
    const { html } = await launch("noact1");
    for (const marker of ["/apps/act1/", "act1", "lesson-title", 'class="choices"', "prompt-row", "progress-bar", "Sensory Learning"]) {
      expect(html, marker).not.toContain(marker);
    }
    expect(html).toContain('src="/apps/money-bingo/js/main.js"');
  });

  it("main.js is the game, not the placeholder, and never names Act 1's app id", async () => {
    const res = await call("GET", "/apps/money-bingo/js/main.js");
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).not.toContain("placeholder");
    expect(js).not.toContain("act1-sensory-learning");
    expect(js).not.toMatch(/Math\.random/);
    expect(js).toContain("getAppId() !== APP_ID");
    for (const path of ["engine/bingo.js", "engine/items.js", "engine/money-svg.js"]) {
      const asset = await call("GET", `/apps/money-bingo/${path}`);
      expect(asset.status, path).toBe(200);
      expect(asset.headers.get("Content-Type"), path).toContain("javascript");
    }
  });
});

describe("Money Bingo progress", () => {
  it("the engine's payload is accepted and lands under money-bingo, not Act 1", async () => {
    const { cookie, child } = await parentWithMoneyBingo("progress");
    const body = progressPayload({ childId: child.id, wins: 1, seconds: 42 });
    const res = await call("POST", "/api/progress", { cookie, body });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.activities_completed).toBe(1);
    expect(out.lesson).toEqual({ lesson_id: "bingo-session", step_index: 1, completed: true });

    const mine = await (await call("GET", `/api/children/${child.id}/progress?app_id=money-bingo`, { cookie })).json();
    expect(mine.lessons.map((l) => l.lesson_id)).toEqual(["bingo-session"]);
    const act1 = await (await call("GET", `/api/children/${child.id}/progress?app_id=act1-sensory-learning`, { cookie })).json();
    expect(act1.lessons).toEqual([]);
  });
});
