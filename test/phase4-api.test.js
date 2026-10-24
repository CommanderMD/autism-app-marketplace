import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { computeUnlocked, LESSON_ORDER } from "../src/routes/progress.js";

// Phase 4 part A: settings, progress, launch gate.
// All fixtures are obviously fake (Rule A4).
const PASSWORD = "correct-horse-battery";
const ACT1 = "act1-sensory-learning";
const DENIAL_TEXT = "This app is not available right now";

async function call(method, path, { body, cookie, ip = "203.0.113.1" } = {}) {
  const headers = { "CF-Connecting-IP": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const request = new Request(`http://example.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function cookieFrom(response) {
  const setCookie = response.headers.get("Set-Cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

// Each login uses its own documentation-range IP so the login rate limit never trips.
let ipCounter = 0;
async function registerAndLogin(email, role = "parent", extra = {}) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role, ...extra } });
  expect(reg.status).toBe(201);
  const login = await call("POST", "/auth/login", {
    body: { email, password: PASSWORD },
    ip: `198.51.100.${++ipCounter % 250}`,
  });
  expect(login.status).toBe(200);
  return { user: await login.json(), cookie: cookieFrom(login) };
}

async function createChild(cookie, name = "Test Child") {
  const res = await call("POST", "/api/children", { cookie, body: { name } });
  expect(res.status).toBe(201);
  return res.json();
}

// A parent with one child, plus a second parent with their own child.
async function twoFamilies(tag) {
  const a = await registerAndLogin(`p4.${tag}.a@example.test`);
  const b = await registerAndLogin(`p4.${tag}.b@example.test`);
  const childA = await createChild(a.cookie, `Fake Child ${tag} A`);
  const childB = await createChild(b.cookie, `Fake Child ${tag} B`);
  return { a, b, childA, childB };
}

function contentType(res) {
  return (res.headers.get("Content-Type") || "").toLowerCase();
}

const settingsPath = (childId, appId = ACT1) => `/api/children/${childId}/settings?app_id=${appId}`;
const progressPath = (childId, appId = ACT1) => `/api/children/${childId}/progress?app_id=${appId}`;
const playPath = (childId, appId = ACT1) => `/apps/${appId}/play?child_id=${childId}`;

function progressBody(childId, extra = {}) {
  return { child_id: childId, app_id: ACT1, lesson_id: "01-shapes", step_index: 0, ...extra };
}

describe("migration 005", () => {
  it("creates child_settings, lesson_progress and app_usage.seconds_used", async () => {
    const tables = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('child_settings', 'lesson_progress') ORDER BY name")
      .all();
    expect(tables.results.map((r) => r.name)).toEqual(["child_settings", "lesson_progress"]);

    const cols = await env.DB.prepare("SELECT name, dflt_value, \"notnull\" FROM pragma_table_info('app_usage') WHERE name = 'seconds_used'").first();
    expect(cols).toEqual({ name: "seconds_used", dflt_value: "0", notnull: 1 });
  });
});

describe("settings", () => {
  it("1. a fresh child gets the documented defaults with is_default true", async () => {
    const { a, childA } = await twoFamilies("defaults");
    const res = await call("GET", settingsPath(childA.id), { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      child_id: childA.id, app_id: ACT1,
      volume: 60, flash_intensity: 50, animation_speed: 1,
      contrast: "normal", animations: true, safe_mode: true,
      is_default: true,
    });
  });

  it("2. PUT a partial object, GET returns it with every other field at its default", async () => {
    const { a, childA } = await twoFamilies("roundtrip");
    const put = await call("PUT", `/api/children/${childA.id}/settings`, {
      cookie: a.cookie, body: { app_id: ACT1, volume: 20, contrast: "high", not_a_field: "ignored" },
    });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody).toMatchObject({ volume: 20, contrast: "high", is_default: false });
    expect(putBody.not_a_field).toBeUndefined();

    const get = await call("GET", settingsPath(childA.id), { cookie: a.cookie });
    expect(await get.json()).toEqual({
      child_id: childA.id, app_id: ACT1,
      volume: 20, flash_intensity: 50, animation_speed: 1,
      contrast: "high", animations: true, safe_mode: true,
      is_default: false,
    });
  });

  it("3. safe_mode only turns off on an explicit false", async () => {
    const { a, childA } = await twoFamilies("safemode");
    const put = (body) => call("PUT", `/api/children/${childA.id}/settings`, { cookie: a.cookie, body: { app_id: ACT1, ...body } });

    expect((await (await put({ volume: 30 })).json()).safe_mode).toBe(true);

    const off = await put({ safe_mode: false });
    expect(off.status).toBe(200);
    expect((await off.json()).safe_mode).toBe(false);

    // Omitting it on an existing row leaves it off, too: omitted keys never change.
    const again = await (await put({ volume: 40 })).json();
    expect(again).toMatchObject({ volume: 40, safe_mode: false });

    const row = await env.DB.prepare("SELECT safe_mode FROM child_settings WHERE child_id = ? AND app_id = ?").bind(childA.id, ACT1).first();
    expect(row.safe_mode).toBe(0);
  });

  it("4. rejects out-of-range and wrong-type values with a message naming the field", async () => {
    const { a, childA } = await twoFamilies("validation");
    const cases = [
      [{ volume: 101 }, "volume"],
      [{ volume: "50" }, "volume"],
      [{ flash_intensity: 2.5 }, "flash_intensity"],
      [{ animation_speed: 0.1 }, "animation_speed"],
      [{ contrast: "purple" }, "contrast"],
      [{ animations: "yes" }, "animations"],
      [{ safe_mode: 0 }, "safe_mode"],
    ];
    for (const [body, field] of cases) {
      const res = await call("PUT", `/api/children/${childA.id}/settings`, { cookie: a.cookie, body: { app_id: ACT1, ...body } });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toContain(field);
    }
    // Nothing was written by any rejected PUT.
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM child_settings WHERE child_id = ?").bind(childA.id).first();
    expect(n.n).toBe(0);
  });

  it("requires a known app_id in both directions", async () => {
    const { a, childA } = await twoFamilies("appid");
    const missingGet = await call("GET", `/api/children/${childA.id}/settings`, { cookie: a.cookie });
    expect(missingGet.status).toBe(400);
    expect(await missingGet.json()).toEqual({ error: "app_id is required" });

    const missingPut = await call("PUT", `/api/children/${childA.id}/settings`, { cookie: a.cookie, body: { volume: 10 } });
    expect(missingPut.status).toBe(400);
    expect(await missingPut.json()).toEqual({ error: "app_id is required" });

    const unknown = await call("GET", settingsPath(childA.id, "no-such-app"), { cookie: a.cookie });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "App not found" });
  });

  it("5. scoping: other parent's child 403, unknown child 404, anonymous 401", async () => {
    const { a, childB } = await twoFamilies("scope");
    const other = await call("GET", settingsPath(childB.id), { cookie: a.cookie });
    expect(other.status).toBe(403);
    const otherBody = await other.text();
    expect(otherBody).not.toContain(childB.id);
    expect(otherBody).not.toContain(childB.name);

    const otherPut = await call("PUT", `/api/children/${childB.id}/settings`, { cookie: a.cookie, body: { app_id: ACT1, safe_mode: false } });
    expect(otherPut.status).toBe(403);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM child_settings WHERE child_id = ?").bind(childB.id).first();
    expect(n.n).toBe(0);

    expect((await call("GET", settingsPath("no-such-child"), { cookie: a.cookie })).status).toBe(404);
    expect((await call("GET", settingsPath(childB.id))).status).toBe(401);
  });
});

describe("progress", () => {
  it("6. two POSTs on one day update a single app_usage row", async () => {
    const { a, childA } = await twoFamilies("upsert");
    const first = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { step_index: 1, seconds: 50 }) });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ ok: true, activities_completed: 1, minutes_used: 0 });
    expect(firstBody.session_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const second = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { step_index: 2, seconds: 40, score: 7 }) });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      ok: true, activities_completed: 2, minutes_used: 1,
      lesson: { lesson_id: "01-shapes", step_index: 2, completed: false },
    });

    const count = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM app_usage WHERE child_id = ? AND app_id = ? AND session_date = ?")
      .bind(childA.id, ACT1, firstBody.session_date).first();
    expect(count.n).toBe(1);

    const row = await env.DB
      .prepare("SELECT seconds_used, minutes_used, activities_completed, score, CAST(seconds_used / 60 AS INTEGER) AS derived FROM app_usage WHERE child_id = ? AND app_id = ?")
      .bind(childA.id, ACT1).first();
    expect(row).toMatchObject({ seconds_used: 90, activities_completed: 2, score: 7 });
    expect(row.minutes_used).toBe(row.derived);

    // A POST with no score keeps the stored score.
    await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id) });
    const kept = await env.DB.prepare("SELECT score FROM app_usage WHERE child_id = ? AND app_id = ?").bind(childA.id, ACT1).first();
    expect(kept.score).toBe(7);
  });

  it("7. another parent's child_id is 403 and writes nothing", async () => {
    const { a, childB } = await twoFamilies("pscope");
    const res = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childB.id, { seconds: 30 }) });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain(childB.id);

    const usage = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_usage WHERE child_id = ?").bind(childB.id).first();
    const lessons = await env.DB.prepare("SELECT COUNT(*) AS n FROM lesson_progress WHERE child_id = ?").bind(childB.id).first();
    expect(usage.n).toBe(0);
    expect(lessons.n).toBe(0);

    expect((await call("GET", progressPath(childB.id), { cookie: a.cookie })).status).toBe(403);
    expect((await call("GET", progressPath("no-such-child"), { cookie: a.cookie })).status).toBe(404);
    expect((await call("POST", "/api/progress", { body: progressBody(childB.id) })).status).toBe(401);
  });

  it("8. rejects a bad lesson_id, step_index or seconds", async () => {
    const { a, childA } = await twoFamilies("pvalid");
    const cases = [
      [{ lesson_id: "Bad Lesson!" }, "lesson_id"],
      [{ lesson_id: "-starts-with-dash" }, "lesson_id"],
      [{ lesson_id: "a".repeat(41) }, "lesson_id"],
      [{ step_index: -1 }, "step_index"],
      [{ step_index: 1.5 }, "step_index"],
      [{ seconds: 9999 }, "seconds"],
      [{ completed: "yes" }, "completed"],
      [{ app_id: 42 }, "app_id"],
    ];
    for (const [extra, field] of cases) {
      const res = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, extra) });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect((await res.json()).error).toContain(field);
    }
    const unknownApp = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { app_id: "no-such-app" }) });
    expect(unknownApp.status).toBe(404);

    const usage = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_usage WHERE child_id = ?").bind(childA.id).first();
    expect(usage.n).toBe(0);
  });

  it("9. unlock chain: first lesson open, N+1 opens after N, a gap stops the chain", async () => {
    const { a, childA } = await twoFamilies("unlock");
    const unlocked = async () => (await (await call("GET", progressPath(childA.id), { cookie: a.cookie })).json()).unlocked;
    const complete = (lessonId) =>
      call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { lesson_id: lessonId, completed: true }) });

    expect(await unlocked()).toEqual(["01-shapes"]);

    expect((await complete("01-shapes")).status).toBe(200);
    expect(await unlocked()).toEqual(["01-shapes", "02-numbers"]);

    // 03 completed while 02 is incomplete: 04 must stay locked.
    expect((await complete("03-nouns")).status).toBe(200);
    expect(await unlocked()).toEqual(["01-shapes", "02-numbers"]);

    // Once complete, a later incomplete POST does not un-complete it.
    await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { completed: false }) });
    const res = await call("GET", progressPath(childA.id), { cookie: a.cookie });
    const body = await res.json();
    expect(body.child_id).toBe(childA.id);
    expect(body.app_id).toBe(ACT1);
    expect(body.lessons).toEqual([
      { lesson_id: "01-shapes", step_index: 0, completed: true, attempts: 2 },
      { lesson_id: "03-nouns", step_index: 0, completed: true, attempts: 1 },
    ]);
  });

  it("computeUnlocked follows curriculum order, not row order", () => {
    expect(computeUnlocked([])).toEqual(["01-shapes"]);
    expect(computeUnlocked([
      { lesson_id: "02-numbers", completed: true },
      { lesson_id: "01-shapes", completed: true },
    ])).toEqual(["01-shapes", "02-numbers", "03-nouns"]);
    expect(computeUnlocked([
      { lesson_id: "01-shapes", completed: true },
      { lesson_id: "02-numbers", completed: false },
      { lesson_id: "03-nouns", completed: true },
    ])).toEqual(["01-shapes", "02-numbers"]);
    expect(computeUnlocked(LESSON_ORDER.map((lesson_id) => ({ lesson_id, completed: true })))).toEqual(LESSON_ORDER);
  });

  it("10. resume keeps the furthest step, not the last one sent", async () => {
    const { a, childA } = await twoFamilies("resume");
    await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { step_index: 3 }) });
    const res = await call("POST", "/api/progress", { cookie: a.cookie, body: progressBody(childA.id, { step_index: 1 }) });
    expect((await res.json()).lesson.step_index).toBe(3);
    const row = await env.DB
      .prepare("SELECT step_index, attempts FROM lesson_progress WHERE child_id = ? AND app_id = ? AND lesson_id = '01-shapes'")
      .bind(childA.id, ACT1).first();
    expect(row).toEqual({ step_index: 3, attempts: 2 });
  });
});

describe("launch gate GET /apps/:appId/play", () => {
  it("11. an expired grant is denied with the HTML denial page; a future expiry is allowed", async () => {
    const { a, childA } = await twoFamilies("expiry");
    const grant = await call("POST", `/api/children/${childA.id}/apps`, { cookie: a.cookie, body: { app_id: ACT1 } });
    expect(grant.status).toBe(201);
    await env.DB
      .prepare("UPDATE child_app_access SET expires_at = datetime('now', '-1 minute') WHERE child_id = ? AND app_id = ?")
      .bind(childA.id, ACT1).run();

    const denied = await call("GET", playPath(childA.id), { cookie: a.cookie });
    expect(denied.status).toBe(403);
    expect(contentType(denied)).toContain("text/html");
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
    const deniedText = await denied.text();
    expect(deniedText).toContain(DENIAL_TEXT);
    expect(deniedText).toContain("ask a grown-up");
    expect(deniedText).not.toContain(childA.id);
    expect(deniedText).not.toContain(childA.name);
    expect(deniedText.toLowerCase()).not.toMatch(/expired|revoked/);

    await env.DB
      .prepare("UPDATE child_app_access SET expires_at = datetime('now', '+1 day') WHERE child_id = ? AND app_id = ?")
      .bind(childA.id, ACT1).run();

    const allowed = await call("GET", playPath(childA.id), { cookie: a.cookie });
    expect(allowed.status).toBe(200);
    expect(contentType(allowed)).toContain("text/html");
    expect(allowed.headers.get("Cache-Control")).toBe("no-store");
    expect(await allowed.text()).toContain("<h1>Act 1</h1>");
  });

  it("a revoked grant gets the same denial page as an expired one", async () => {
    const { a, childA } = await twoFamilies("revoked");
    await call("POST", `/api/children/${childA.id}/apps`, { cookie: a.cookie, body: { app_id: ACT1 } });
    expect((await call("DELETE", `/api/children/${childA.id}/apps/${ACT1}`, { cookie: a.cookie })).status).toBe(200);
    const res = await call("GET", playPath(childA.id), { cookie: a.cookie });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(DENIAL_TEXT);
  });

  it("12. no grant, other parent's child, unknown child, no session, unknown app, wrong method", async () => {
    const { a, b, childA, childB } = await twoFamilies("gate");
    // childB has a live grant, so the 403 below is about ownership, not the grant.
    await call("POST", `/api/children/${childB.id}/apps`, { cookie: b.cookie, body: { app_id: ACT1 } });

    const noGrant = await call("GET", playPath(childA.id), { cookie: a.cookie });
    expect(noGrant.status).toBe(403);
    expect(contentType(noGrant)).toContain("text/html");
    expect(await noGrant.text()).toContain(DENIAL_TEXT);

    const other = await call("GET", playPath(childB.id), { cookie: a.cookie });
    expect(other.status).toBe(403);
    const otherText = await other.text();
    expect(otherText).not.toContain(childB.name);
    expect(otherText).not.toContain("<h1>Act 1</h1>");

    expect((await call("GET", playPath("no-such-child"), { cookie: a.cookie })).status).toBe(404);

    const missingChild = await call("GET", `/apps/${ACT1}/play`, { cookie: a.cookie });
    expect(missingChild.status).toBe(400);
    expect(await missingChild.json()).toEqual({ error: "child_id is required" });

    const anon = await call("GET", playPath(childA.id));
    expect(anon.status).toBe(302);
    const location = anon.headers.get("Location");
    expect(location.startsWith("/login?next=")).toBe(true);
    expect(decodeURIComponent(location.slice("/login?next=".length))).toBe(playPath(childA.id));

    const unknownApp = await call("GET", playPath(childA.id, "no-such-app"), { cookie: a.cookie });
    expect(unknownApp.status).toBe(404);
    expect(contentType(unknownApp)).toContain("application/json");
    expect(await unknownApp.json()).toEqual({ error: "App not found" });

    const post = await call("POST", playPath(childA.id), { cookie: a.cookie });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
  });

  it("a missing ASSETS binding is a JSON 500, never a silent HTML fallback", async () => {
    const { a, childA } = await twoFamilies("noassets");
    await call("POST", `/api/children/${childA.id}/apps`, { cookie: a.cookie, body: { app_id: ACT1 } });
    const request = new Request(`http://example.com${playPath(childA.id)}`, { headers: { Cookie: a.cookie } });
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, { ...env, ASSETS: undefined }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Assets binding not configured" });
  });

  it("the shell and denial assets are not reachable around the gate", async () => {
    for (const path of ["/apps/act1/", "/apps/act1/index.html", "/apps/act1/denied", "/apps/act1/denied.html"]) {
      const res = await call("GET", path);
      expect(res.status, path).toBe(404);
      expect(contentType(res), path).toContain("application/json");
    }
  });
});

describe("13. routing contract", () => {
  it("/apps/:id is still JSON app detail and /apps/:id/play is HTML", async () => {
    const detail = await call("GET", `/apps/${ACT1}`);
    expect(detail.status).toBe(200);
    expect(contentType(detail)).toContain("application/json");
    expect((await detail.json()).id).toBe(ACT1);

    const { a, childA } = await twoFamilies("contract");
    await call("POST", `/api/children/${childA.id}/apps`, { cookie: a.cookie, body: { app_id: ACT1 } });
    const play = await call("GET", playPath(childA.id), { cookie: a.cookie });
    expect(play.status).toBe(200);
    expect(contentType(play)).toContain("text/html");
  });

  for (const [method, path] of [
    ["GET", "/api/children/x/settings"],
    ["PUT", "/api/children/x/settings"],
    ["GET", "/api/children/x/progress"],
    ["POST", "/api/progress"],
  ]) {
    it(`${method} ${path} unauthenticated is JSON 401, never HTML`, async () => {
      const res = await call(method, path);
      expect(res.status).toBe(401);
      expect(contentType(res)).toContain("application/json");
      const text = await res.text();
      expect(text.toLowerCase()).not.toContain("<html");
      expect(JSON.parse(text).error).toBe("Unauthorized");
    });
  }
});
