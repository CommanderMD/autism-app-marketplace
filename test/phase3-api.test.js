import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// All fixtures are obviously fake (Rule A4).
const PASSWORD = "correct-horse-battery";

async function call(method, path, { body, cookie, ip = "203.0.113.1" } = {}) {
  const headers = { "CF-Connecting-IP": ip };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const request = new Request(`http://example.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

// Each login uses its own documentation-range IP so tests that sign in many
// users never hit the 10-per-minute login limit.
let ipCounter = 0;
async function login(email) {
  const res = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `192.0.2.${++ipCounter % 250}` });
  expect(res.status).toBe(200);
  return { user: await res.json(), cookie: cookieFrom(res) };
}

async function registerAndLogin(email, role = "parent", extra = {}) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role, ...extra } });
  expect(reg.status).toBe(201);
  return login(email);
}

// Seeds a platform admin directly, as scripts/bootstrap-admin.mjs would.
async function platformAdmin(email = "ops@example.test") {
  const { user } = await registerAndLogin(email);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM parents WHERE id = ?").bind(user.id),
    env.DB.prepare("UPDATE users SET role = 'platform_admin' WHERE id = ?").bind(user.id),
  ]);
  return login(email);
}

async function createChild(cookie, name) {
  const res = await call("POST", "/api/children", { cookie, body: { name } });
  expect(res.status).toBe(201);
  return res.json();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// Phase 5: a school child needs a seat on a current license before a grant.
async function seedLicense(schoolId, appId, seats) {
  await env.DB
    .prepare("INSERT INTO school_licenses (id, school_id, app_id, seats, starts_at) VALUES (?, ?, ?, ?, date('now'))")
    .bind(crypto.randomUUID(), schoolId, appId, seats)
    .run();
}

async function seedUsage(childId, appId, sessionDate, minutes, activities, score = null) {
  await env.DB
    .prepare("INSERT INTO app_usage (child_id, app_id, session_date, minutes_used, activities_completed, score) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(childId, appId, sessionDate, minutes, activities, score)
    .run();
}

describe("API / asset split", () => {
  it("GET /api/status is JSON, GET / is HTML", async () => {
    const status = await call("GET", "/api/status");
    expect(status.status).toBe(200);
    expect(status.headers.get("Content-Type")).toContain("application/json");
    expect(await status.json()).toEqual({ name: "Autism App Marketplace API", status: "online" });

    const root = await call("GET", "/");
    expect(root.status).toBe(200);
    expect(root.headers.get("Content-Type")).toContain("text/html");
  });

  it("unknown paths in JSON namespaces stay JSON, even with a session or a file extension", async () => {
    const { cookie } = await registerAndLogin("parent.split@example.test");
    for (const path of ["/api/does-not-exist", "/api/school/whatever", "/api/admin/whatever", "/api/x.js"]) {
      const res = await call("GET", path, { cookie });
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(await res.text()).not.toMatch(/<html/i);
    }
    const nested = await call("GET", "/apps/money-bingo/extra");
    expect(nested.status).toBe(404);
    expect(nested.headers.get("Content-Type")).toContain("application/json");
  });

  it("a malformed escape in an /api path is a JSON 400, not a platform error page", async () => {
    const { cookie } = await registerAndLogin("parent.uri@example.test");
    const res = await call("GET", "/api/children/%E0%A4%A", { cookie });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns a JSON 500 when the ASSETS binding is missing", async () => {
    const request = new Request("http://example.com/parent");
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, { ...env, ASSETS: undefined }, ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Assets binding not configured" });
  });
});

describe("GET /api/usage/summary", () => {
  it("child scope: own child 200, other parent 403, unknown 404, empty is zeros", async () => {
    const { cookie: cookieA } = await registerAndLogin("parent.ua@example.test");
    const { cookie: cookieB } = await registerAndLogin("parent.ub@example.test");
    const child = await createChild(cookieA, "Test Child U");

    // Empty: zeros and empty arrays, never 404/null
    const empty = await call("GET", `/api/usage/summary?child_id=${child.id}`, { cookie: cookieA });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      scope: "child", child_id: child.id, days: 7,
      totals: { minutes: 0, activities: 0 }, by_app: [], by_day: [],
    });

    await seedUsage(child.id, "money-bingo", today(), 10, 2);
    await seedUsage(child.id, "word-builder", today(), 5, 1);
    await seedUsage(child.id, "money-bingo", daysAgo(6), 7, 3);
    await seedUsage(child.id, "money-bingo", daysAgo(7), 100, 100); // outside the 7-day window

    const res = await call("GET", `/api/usage/summary?child_id=${child.id}`, { cookie: cookieA });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toEqual({ minutes: 22, activities: 6 });
    expect(body.by_app).toEqual([
      { app_id: "money-bingo", app_name: "Money Bingo", minutes: 17, activities: 5 },
      { app_id: "word-builder", app_name: "Word Builder", minutes: 5, activities: 1 },
    ]);
    expect(body.by_day).toEqual([
      { date: daysAgo(6), minutes: 7, activities: 3 },
      { date: today(), minutes: 15, activities: 3 },
    ]);

    const other = await call("GET", `/api/usage/summary?child_id=${child.id}`, { cookie: cookieB });
    expect(other.status).toBe(403);
    const otherBody = await other.json();
    expect(otherBody.totals).toBeUndefined();

    const missing = await call("GET", "/api/usage/summary?child_id=does-not-exist", { cookie: cookieA });
    expect(missing.status).toBe(404);
  });

  it("school scope: own school 200, other school 403, parent 403, platform_admin 200", async () => {
    const { user: admin1, cookie: adminCookie1 } = await registerAndLogin("admin.u1@example.test", "school_admin", { school_name: "Test School U1" });
    const { user: admin2, cookie: adminCookie2 } = await registerAndLogin("admin.u2@example.test", "school_admin", { school_name: "Test School U2" });
    const childS1 = await createChild(adminCookie1, "Test Child S1");
    const childS2 = await createChild(adminCookie2, "Test Child S2");
    await seedUsage(childS1.id, "money-bingo", today(), 12, 4);
    await seedUsage(childS2.id, "money-bingo", today(), 99, 99);

    const own = await call("GET", `/api/usage/summary?school_id=${admin1.school_id}`, { cookie: adminCookie1 });
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.scope).toBe("school");
    expect(body.totals).toEqual({ minutes: 12, activities: 4 });
    expect(body.by_child).toEqual([{ child_id: childS1.id, child_name: "Test Child S1", minutes: 12, activities: 4 }]);
    expect(body.by_app).toEqual([{ app_id: "money-bingo", app_name: "Money Bingo", minutes: 12, activities: 4 }]);

    const cross = await call("GET", `/api/usage/summary?school_id=${admin2.school_id}`, { cookie: adminCookie1 });
    expect(cross.status).toBe(403);
    expect((await cross.json()).by_child).toBeUndefined();

    const { cookie: parentCookie } = await registerAndLogin("parent.us@example.test");
    expect((await call("GET", `/api/usage/summary?school_id=${admin1.school_id}`, { cookie: parentCookie })).status).toBe(403);

    const { cookie: opsCookie } = await platformAdmin();
    const ops = await call("GET", `/api/usage/summary?school_id=${admin2.school_id}`, { cookie: opsCookie });
    expect(ops.status).toBe(200);
    expect((await ops.json()).totals).toEqual({ minutes: 99, activities: 99 });
  });

  it("neither child_id nor school_id is 400", async () => {
    const { cookie } = await registerAndLogin("parent.un@example.test");
    const res = await call("GET", "/api/usage/summary", { cookie });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "child_id or school_id is required" });
  });
});

describe("DELETE /api/children/:id/apps/:appId", () => {
  it("soft-revokes idempotently, 404 for never-granted, 403 for another parent, re-grant reactivates", async () => {
    const { cookie: cookieA } = await registerAndLogin("parent.ra@example.test");
    const { cookie: cookieB } = await registerAndLogin("parent.rb@example.test");
    const child = await createChild(cookieA, "Test Child R");

    expect((await call("POST", `/api/children/${child.id}/apps`, { cookie: cookieA, body: { app_id: "money-bingo" } })).status).toBe(201);

    const revoke = await call("DELETE", `/api/children/${child.id}/apps/money-bingo`, { cookie: cookieA });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ child_id: child.id, app_id: "money-bingo", is_active: 0 });

    const again = await call("DELETE", `/api/children/${child.id}/apps/money-bingo`, { cookie: cookieA });
    expect(again.status).toBe(200);
    expect((await again.json()).is_active).toBe(0);

    const never = await call("DELETE", `/api/children/${child.id}/apps/word-builder`, { cookie: cookieA });
    expect(never.status).toBe(404);
    expect(await never.json()).toEqual({ error: "App is not granted to this child" });

    const other = await call("DELETE", `/api/children/${child.id}/apps/money-bingo`, { cookie: cookieB });
    expect(other.status).toBe(403);

    // History kept: the row still exists
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM child_app_access WHERE child_id = ?").bind(child.id).first();
    expect(rows.n).toBe(1);

    // Granting again switches it back on
    const regrant = await call("POST", `/api/children/${child.id}/apps`, { cookie: cookieA, body: { app_id: "money-bingo" } });
    expect(regrant.status).toBe(201);
    expect((await regrant.json()).is_active).toBe(1);
  });
});

describe("GET /api/children/:id/apps", () => {
  async function grant(cookie, childId, appId) {
    const res = await call("POST", `/api/children/${childId}/apps`, { cookie, body: { app_id: appId } });
    expect(res.status).toBe(201);
  }

  async function listApps(cookie, childId, query = "") {
    const res = await call("GET", `/api/children/${childId}/apps${query}`, { cookie });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("lists active grants joined to app metadata; include_revoked shows revoked rows with is_active 0", async () => {
    const { user, cookie } = await registerAndLogin("parent.la@example.test");
    const child = await createChild(cookie, "Test Child L");
    await grant(cookie, child.id, "money-bingo");
    await grant(cookie, child.id, "word-builder");

    const both = await listApps(cookie, child.id);
    expect(both).toHaveLength(2);
    const byId = Object.fromEntries(both.map((a) => [a.app_id, a]));
    expect(byId["money-bingo"]).toMatchObject({ name: "Money Bingo", category: "finance", granted_by: user.id, expires_at: null });
    expect(byId["word-builder"]).toMatchObject({ name: "Word Builder", category: "cognition", granted_by: user.id, expires_at: null });
    expect(byId["money-bingo"].granted_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(Object.keys(byId["money-bingo"]).sort()).toEqual(["app_id", "category", "expires_at", "granted_at", "granted_by", "name"]);

    expect((await call("DELETE", `/api/children/${child.id}/apps/money-bingo`, { cookie })).status).toBe(200);

    const active = await listApps(cookie, child.id);
    expect(active.map((a) => a.app_id)).toEqual(["word-builder"]);

    const all = await listApps(cookie, child.id, "?include_revoked=1");
    expect(all).toHaveLength(2);
    const allById = Object.fromEntries(all.map((a) => [a.app_id, a]));
    expect(allById["money-bingo"].is_active).toBe(0);
    expect(allById["word-builder"].is_active).toBe(1);
  });

  it("another parent 403, unknown child 404, no cookie 401, GET/POST only", async () => {
    const { cookie: cookieA } = await registerAndLogin("parent.lb@example.test");
    const { cookie: cookieB } = await registerAndLogin("parent.lc@example.test");
    const child = await createChild(cookieA, "Test Child M");
    await grant(cookieA, child.id, "money-bingo");

    const other = await call("GET", `/api/children/${child.id}/apps`, { cookie: cookieB });
    expect(other.status).toBe(403);
    expect(await other.text()).not.toContain("money-bingo");
    const otherAll = await call("GET", `/api/children/${child.id}/apps?include_revoked=1`, { cookie: cookieB });
    expect(otherAll.status).toBe(403);

    expect((await call("GET", "/api/children/does-not-exist/apps", { cookie: cookieA })).status).toBe(404);
    expect((await call("GET", `/api/children/${child.id}/apps`)).status).toBe(401);

    const put = await call("PUT", `/api/children/${child.id}/apps`, { cookie: cookieA });
    expect(put.status).toBe(405);
    expect(put.headers.get("Allow")).toBe("GET, POST");
  });

  it("a child with no grants is [] with 200", async () => {
    const { cookie } = await registerAndLogin("parent.ld@example.test");
    const child = await createChild(cookie, "Test Child N");
    expect(await listApps(cookie, child.id)).toEqual([]);
    expect(await listApps(cookie, child.id, "?include_revoked=1")).toEqual([]);
  });

  it("an expired grant is absent by default and present (is_active 0) with include_revoked", async () => {
    const { cookie } = await registerAndLogin("parent.le@example.test");
    const child = await createChild(cookie, "Test Child E");
    await grant(cookie, child.id, "money-bingo");
    await grant(cookie, child.id, "word-builder");
    await env.DB
      .prepare("UPDATE child_app_access SET expires_at = datetime('now', '-1 minute') WHERE child_id = ? AND app_id = 'money-bingo'")
      .bind(child.id)
      .run();
    await env.DB
      .prepare("UPDATE child_app_access SET expires_at = datetime('now', '+1 day') WHERE child_id = ? AND app_id = 'word-builder'")
      .bind(child.id)
      .run();

    const active = await listApps(cookie, child.id);
    expect(active.map((a) => a.app_id)).toEqual(["word-builder"]);
    expect(active[0].expires_at).not.toBeNull();

    const all = await listApps(cookie, child.id, "?include_revoked=1");
    const expired = all.find((a) => a.app_id === "money-bingo");
    expect(expired).toBeDefined();
    expect(expired.is_active).toBe(0);
    expect(all.find((a) => a.app_id === "word-builder").is_active).toBe(1);
  });
});

describe("POST /api/school/children/apps (bulk grant)", () => {
  it("grants, is idempotent, and rejects other schools' children without inserting anything", async () => {
    const { cookie: adminCookie1, user: admin1 } = await registerAndLogin("admin.b1@example.test", "school_admin", { school_name: "Test School B1" });
    const { cookie: adminCookie2 } = await registerAndLogin("admin.b2@example.test", "school_admin", { school_name: "Test School B2" });
    await seedLicense(admin1.school_id, "word-builder", 3);
    await seedLicense(admin1.school_id, "emotion-match", 10);
    const kids = [];
    for (const n of [1, 2, 3]) kids.push(await createChild(adminCookie1, `Test Child B${n}`));
    const foreign = await createChild(adminCookie2, "Test Child F");
    const ids = kids.map((k) => k.id);

    const first = await call("POST", "/api/school/children/apps", { cookie: adminCookie1, body: { child_ids: ids, app_id: "word-builder" } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ granted: 3, already_granted: 0, app_id: "word-builder" });

    const rerun = await call("POST", "/api/school/children/apps", { cookie: adminCookie1, body: { child_ids: ids, app_id: "word-builder" } });
    expect(await rerun.json()).toEqual({ granted: 0, already_granted: 3, app_id: "word-builder" });

    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM child_app_access").first()).n;
    const cross = await call("POST", "/api/school/children/apps", {
      cookie: adminCookie1,
      body: { child_ids: [...ids, foreign.id], app_id: "emotion-match" },
    });
    expect(cross.status).toBe(403);
    const crossText = await cross.text();
    expect(crossText).not.toContain(foreign.id);
    expect(JSON.parse(crossText).rejected).toBe(1);
    const after = (await env.DB.prepare("SELECT COUNT(*) AS n FROM child_app_access").first()).n;
    expect(after).toBe(before);
    expect(await env.DB.prepare("SELECT 1 FROM child_app_access WHERE app_id = 'emotion-match'").first()).toBeNull();
  });

  it("rejects >500 ids with 400 and non-school_admins with 403", async () => {
    const { cookie: adminCookie } = await registerAndLogin("admin.b3@example.test", "school_admin", { school_name: "Test School B3" });
    const tooMany = Array.from({ length: 501 }, (_, i) => `fake-child-${i}`);
    const res = await call("POST", "/api/school/children/apps", { cookie: adminCookie, body: { child_ids: tooMany, app_id: "money-bingo" } });
    expect(res.status).toBe(400);

    const { cookie: parentCookie } = await registerAndLogin("parent.b@example.test");
    const parent = await call("POST", "/api/school/children/apps", { cookie: parentCookie, body: { child_ids: ["x"], app_id: "money-bingo" } });
    expect(parent.status).toBe(403);
  });
});

describe("GET /api/school/usage.csv", () => {
  it("returns an attachment with a date-only filename, header row, and RFC 4180 quoting", async () => {
    const { cookie: adminCookie } = await registerAndLogin("admin.c1@example.test", "school_admin", { school_name: "Test School C1" });
    const { cookie: otherAdmin } = await registerAndLogin("admin.c2@example.test", "school_admin", { school_name: "Test School C2" });

    // Empty school: header only, still 200
    const empty = await call("GET", "/api/school/usage.csv", { cookie: adminCookie });
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe("child_name,app_name,session_date,minutes_used,activities_completed,score\r\n");

    const child = await createChild(adminCookie, 'Test, Child "Q"');
    const formula = await createChild(adminCookie, "=Test Child Formula");
    const foreign = await createChild(otherAdmin, "Test Child Elsewhere");
    await seedUsage(child.id, "money-bingo", "2026-10-01", 15, 3, 80);
    await seedUsage(formula.id, "word-builder", "2026-09-30", 5, 1);
    await seedUsage(foreign.id, "money-bingo", "2026-10-01", 1, 1);

    const res = await call("GET", "/api/school/usage.csv", { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition");
    const filename = disposition.match(/filename="([^"]+)"/)[1];
    expect(filename).toMatch(/^usage-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(disposition).not.toContain("Child");

    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe("child_name,app_name,session_date,minutes_used,activities_completed,score");
    expect(lines[1]).toBe('"Test, Child ""Q""",Money Bingo,2026-10-01,15,3,80');
    expect(lines[2]).toBe("'=Test Child Formula,Word Builder,2026-09-30,5,1,");
    expect(lines).toHaveLength(4); // header, 2 rows, trailing empty after final CRLF
    expect(lines.join("\n")).not.toContain("Elsewhere");
  });

  it("is school_admin only", async () => {
    const { cookie } = await registerAndLogin("parent.csv@example.test");
    expect((await call("GET", "/api/school/usage.csv", { cookie })).status).toBe(403);
    expect((await call("GET", "/api/school/usage.csv")).status).toBe(401);
  });
});

describe("platform admin routes", () => {
  it("create app 201, duplicate 409, deactivate hides it from public /apps only", async () => {
    const { cookie } = await platformAdmin();

    const create = await call("POST", "/api/admin/apps", {
      cookie,
      body: { name: "Test Fake App", category: "testing", age_min: 3, age_max: 9, difficulty_level: 2 },
    });
    expect(create.status).toBe(201);
    const app = await create.json();
    expect(app).toMatchObject({ id: "test-fake-app", name: "Test Fake App", category: "testing", is_active: 1 });

    const dup = await call("POST", "/api/admin/apps", { cookie, body: { name: "Test Fake App", category: "testing" } });
    expect(dup.status).toBe(409);

    const bad = await call("POST", "/api/admin/apps", { cookie, body: { name: "Bad", category: "testing", difficulty_level: 9 } });
    expect(bad.status).toBe(400);

    const publicBefore = await (await call("GET", "/apps")).json();
    expect(publicBefore.map((a) => a.id)).toContain("test-fake-app");

    const patch = await call("PATCH", "/api/admin/apps/test-fake-app", { cookie, body: { is_active: false, description: "Retired" } });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ is_active: 0, description: "Retired" });

    const publicAfter = await (await call("GET", "/apps")).json();
    expect(publicAfter.map((a) => a.id)).not.toContain("test-fake-app");

    const adminList = await (await call("GET", "/api/admin/apps", { cookie })).json();
    expect(adminList.find((a) => a.id === "test-fake-app")).toMatchObject({ is_active: 0 });

    expect((await call("PATCH", "/api/admin/apps/does-not-exist", { cookie, body: { name: "X" } })).status).toBe(404);
  });

  it("creates and lists schools, assigns a school_admin to a school", async () => {
    const { cookie } = await platformAdmin();
    const create = await call("POST", "/api/admin/schools", { cookie, body: { name: "Test School Admin", contact_email: "office@example.test" } });
    expect(create.status).toBe(201);
    const school = await create.json();
    expect(school).toMatchObject({ name: "Test School Admin", contact_email: "office@example.test" });

    const list = await (await call("GET", "/api/admin/schools", { cookie })).json();
    expect(list.map((s) => s.id)).toContain(school.id);

    const { user: schoolAdmin } = await registerAndLogin("admin.assign@example.test", "school_admin");
    const assign = await call("POST", `/api/admin/users/${schoolAdmin.id}/school`, { cookie, body: { school_id: school.id } });
    expect(assign.status).toBe(200);
    expect((await assign.json()).school_id).toBe(school.id);

    const { user: parent } = await registerAndLogin("parent.assign@example.test");
    expect((await call("POST", `/api/admin/users/${parent.id}/school`, { cookie, body: { school_id: school.id } })).status).toBe(400);
    expect((await call("POST", `/api/admin/users/${schoolAdmin.id}/school`, { cookie, body: { school_id: "no-such-school" } })).status).toBe(400);
  });

  it("rejects a parent with 403 and an anonymous caller with 401", async () => {
    const { cookie } = await registerAndLogin("parent.adm@example.test");
    const routes = [
      ["GET", "/api/admin/apps"], ["POST", "/api/admin/apps"], ["PATCH", "/api/admin/apps/money-bingo"],
      ["GET", "/api/admin/schools"], ["POST", "/api/admin/schools"], ["POST", "/api/admin/users/x/school"],
    ];
    for (const [method, path] of routes) {
      const body = method === "GET" ? undefined : { name: "Test" };
      expect((await call(method, path, { cookie, body })).status).toBe(403);
      expect((await call(method, path, { body })).status).toBe(401);
    }
    // The parent did not change anything
    expect((await env.DB.prepare("SELECT name FROM apps WHERE id = 'money-bingo'").first()).name).toBe("Money Bingo");
  });
});

describe("school invites", () => {
  it("a school_admin registering with an invite joins the inviter's school; the code works once", async () => {
    const { user: inviter, cookie: inviterCookie } = await registerAndLogin("admin.inv@example.test", "school_admin", { school_name: "Test School Inv" });

    const create = await call("POST", "/api/school/invites", { cookie: inviterCookie });
    expect(create.status).toBe(201);
    const invite = await create.json();
    expect(Object.keys(invite).sort()).toEqual(["code", "expires_at"]);
    expect(invite.code).toMatch(/^[A-Z0-9]{8}$/);

    // Public pre-check does not consume the code or reveal the inviter
    const check = await call("POST", `/api/school/invites/${invite.code}/redeem`);
    expect(check.status).toBe(200);
    const checkText = await check.text();
    expect(checkText).not.toContain("admin.inv@example.test");
    expect(checkText).not.toContain(inviter.id);

    const schoolsBefore = (await env.DB.prepare("SELECT COUNT(*) AS n FROM schools").first()).n;
    const reg = await call("POST", "/auth/register", {
      body: { email: "admin.joiner@example.test", password: PASSWORD, role: "school_admin", invite_code: invite.code, school_name: "Ignored" },
    });
    expect(reg.status).toBe(201);
    const joiner = await reg.json();
    expect(joiner.school_id).toBe(inviter.school_id);
    expect(JSON.stringify(joiner)).not.toContain("admin.inv@example.test");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM schools").first()).n).toBe(schoolsBefore);
    expect((await env.DB.prepare("SELECT used_at FROM school_invites WHERE code = ?").bind(invite.code).first()).used_at).not.toBeNull();

    const second = await call("POST", "/auth/register", {
      body: { email: "admin.second@example.test", password: PASSWORD, role: "school_admin", invite_code: invite.code },
    });
    expect(second.status).toBe(400);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE email = 'admin.second@example.test'").first()).toBeNull();
    expect((await call("POST", `/api/school/invites/${invite.code}/redeem`)).status).toBe(400);
  });

  it("rejects expired codes, wrong role, wrong bound email, and non-school_admin creators", async () => {
    const { cookie } = await registerAndLogin("admin.inv2@example.test", "school_admin", { school_name: "Test School Inv2" });

    const expired = await (await call("POST", "/api/school/invites", { cookie })).json();
    await env.DB.prepare("UPDATE school_invites SET expires_at = datetime('now', '-1 minute') WHERE code = ?").bind(expired.code).run();
    const regExpired = await call("POST", "/auth/register", {
      body: { email: "admin.late@example.test", password: PASSWORD, role: "school_admin", invite_code: expired.code },
    });
    expect(regExpired.status).toBe(400);

    const valid = await (await call("POST", "/api/school/invites", { cookie })).json();
    const wrongRole = await call("POST", "/auth/register", {
      body: { email: "parent.inv@example.test", password: PASSWORD, role: "parent", invite_code: valid.code },
    });
    expect(wrongRole.status).toBe(400);

    const bound = await (await call("POST", "/api/school/invites", { cookie, body: { email: "only.this@example.test" } })).json();
    const wrongEmail = await call("POST", "/auth/register", {
      body: { email: "someone.else@example.test", password: PASSWORD, role: "school_admin", invite_code: bound.code },
    });
    expect(wrongEmail.status).toBe(400);
    const rightEmail = await call("POST", "/auth/register", {
      body: { email: "Only.This@example.test", password: PASSWORD, role: "school_admin", invite_code: bound.code },
    });
    expect(rightEmail.status).toBe(201);

    const { cookie: parentCookie } = await registerAndLogin("parent.inv2@example.test");
    expect((await call("POST", "/api/school/invites", { cookie: parentCookie })).status).toBe(403);
  });
});

describe("migration 004", () => {
  it("rejects a duplicate (child_id, app_id, session_date) usage row", async () => {
    const { cookie } = await registerAndLogin("parent.dup@example.test");
    const child = await createChild(cookie, "Test Child Dup");
    await seedUsage(child.id, "money-bingo", "2026-10-01", 5, 1);
    await expect(seedUsage(child.id, "money-bingo", "2026-10-01", 5, 1)).rejects.toThrow(/UNIQUE/);
    // A different day is fine
    await seedUsage(child.id, "money-bingo", "2026-10-02", 5, 1);
  });

  it("creates _migrations with 001-003 backfilled, and is safe to apply twice", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM _migrations ORDER BY name").all();
    expect(results.map((r) => r.name)).toEqual(["001_init.sql", "002_seed_apps.sql", "003_auth.sql"]);

    const m004 = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("004"));
    await env.DB.batch(m004.queries.map((q) => env.DB.prepare(q)));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM _migrations").first()).n).toBe(3);
  });
});
