import { env, createExecutionContext, waitOnExecutionContext, createScheduledController } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { SECURITY_HEADERS } from "../src/security.js";
import { sanitizeDetail } from "../src/audit.js";

// Phase 5 server half: security headers + same-origin rule, funding seats,
// expired-grant regrant, standards/goals, nightly rollup, audit log.
// All fixtures are obviously fake (Rule A4).

const PASSWORD = "correct-horse-battery";
const ACT1 = "act1-sensory-learning";

async function call(method, path, { body, cookie, ip = "203.0.113.50", headers: extra = {} } = {}) {
  const headers = { "CF-Connecting-IP": ip, ...extra };
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

const cookieFrom = (res) => (res.headers.get("Set-Cookie") || "").split(";")[0] || null;

let ipCounter = 0;
async function login(email) {
  const res = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(res.status).toBe(200);
  return { user: await res.json(), cookie: cookieFrom(res) };
}
async function registerAndLogin(email, role = "parent", extra = {}) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role, ...extra } });
  expect(reg.status).toBe(201);
  return login(email);
}
async function platformAdmin(email) {
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
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("security headers and same-origin rule", () => {
  it("1. every response carries the Kemet-OS set and a CSP: JSON, gate HTML, asset, 404, 405", async () => {
    const samples = [
      await call("GET", "/health"),
      await call("GET", "/api/status"),
      await call("GET", "/apps/nope/zzz"),               // JSON 404
      await call("DELETE", "/auth/login"),               // 405
      await call("GET", "/apps/act1/js/shell.js"),       // asset via allowlist
      await call("GET", "/"),                            // SPA asset
      await call("GET", `/apps/${ACT1}/play`),           // gate redirect (302)
    ];
    for (const res of samples) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(k), `${k} on ${res.url || res.status}`).toBe(v);
      }
      expect(res.headers.get("Server")).toBeNull();
    }
    expect(samples[0].headers.get("X-Empire-Layer")).toBe("Kemet-OS-Security-v1");
    expect(samples[0].headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(samples[0].headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");
  });

  it("2. /api and /auth responses are no-store; a CSV keeps its own Cache-Control", async () => {
    expect((await call("GET", "/api/status")).headers.get("Cache-Control")).toBe("no-store");
    const { cookie } = await registerAndLogin("p5.cache@example.test", "school_admin", { school_name: "Test School Cache" });
    const csv = await call("GET", "/api/school/usage.csv", { cookie });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Cache-Control")).toBe("no-store");
    expect(csv.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("3. a mutating request with a foreign Origin is refused before any handler; same origin and no Origin pass", async () => {
    const foreign = await call("POST", "/auth/login", { body: { email: "x@example.test", password: PASSWORD }, headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "Cross-origin request refused" });

    const crossSite = await call("POST", "/api/children", { body: { name: "x" }, headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(crossSite.status).toBe(403);

    const same = await call("POST", "/auth/login", { body: { email: "nobody@example.test", password: PASSWORD }, headers: { Origin: "http://example.com" }, ip: "198.51.100.251" });
    expect(same.status).toBe(401); // reached the handler: wrong credentials, not refused

    // A GET with a foreign Origin is harmless (no CORS headers are ever sent).
    const get = await call("GET", "/api/status", { headers: { Origin: "https://evil.example" } });
    expect(get.status).toBe(200);
    expect(get.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await call("OPTIONS", "/api/children", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("4. no inline script or style anywhere in public/ (CSP has no unsafe-inline)", async () => {
    const pages = ["/", "/login", "/parent", "/school", "/admin", "/app/x", "/apps/act1/dev"];
    for (const p of pages) {
      const html = await (await call("GET", p)).text();
      expect(html, p).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S/); // no inline script body
      expect(html, p).not.toMatch(/<style[\s>]/);
      expect(html, p).not.toMatch(/\sstyle="/);
      expect(html, p).not.toMatch(/\son[a-z]+="/);
    }
    const shell = await (await env.ASSETS.fetch(new Request("http://example.com/apps/act1/"))).text();
    const denied = await (await env.ASSETS.fetch(new Request("http://example.com/apps/act1/denied"))).text();
    for (const html of [shell, denied]) {
      expect(html).not.toMatch(/<style[\s>]/);
      expect(html).not.toMatch(/\sstyle="/);
    }
    // And no JS builds a style attribute either (CSSOM assignments are fine).
    for (const f of ["/js/views/parent.js", "/js/views/school.js", "/js/views/admin.js", "/js/ui.js", "/apps/act1/js/shell.js", "/apps/act1/js/reward-player.js"]) {
      const js = await (await call("GET", f)).text();
      expect(js, f).not.toMatch(/style:\s*[`'"]/);
      expect(js, f).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    }
  });
});

describe("funding: seats on school licenses", () => {
  it("5. a school child needs a current license with a free seat; a self-funded child never does", async () => {
    const { cookie: admin, user: adminUser } = await registerAndLogin("p5.seat.admin@example.test", "school_admin", { school_name: "Test School Seats" });
    const { cookie: parent } = await registerAndLogin("p5.seat.parent@example.test");
    const home = await createChild(parent, "Fake Child Home");
    const k1 = await createChild(admin, "Fake Child S1");
    const k2 = await createChild(admin, "Fake Child S2");

    // No license at all: 409 with code no_seats, nothing inserted.
    const none = await call("POST", `/api/children/${k1.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } });
    expect(none.status).toBe(409);
    const noneBody = await none.json();
    expect(noneBody.code).toBe("no_seats");
    expect(noneBody.seats).toBe(0);
    expect(JSON.stringify(noneBody)).not.toContain("Fake Child");

    // Self-funded child: no check.
    expect((await call("POST", `/api/children/${home.id}/apps`, { cookie: parent, body: { app_id: "money-bingo" } })).status).toBe(201);

    // One seat, starting today: first grant 201, repeat 200 (no new seat), second child 409.
    const { cookie: ops } = await platformAdmin("p5.seat.ops@example.test");
    const lic = await call("POST", `/api/admin/schools/${adminUser.school_id}/licenses`, { cookie: ops, body: { app_id: "money-bingo", seats: 1, funding_source_id: "grant", notes: "Fake Grant 2026" } });
    expect(lic.status).toBe(201);
    const license = await lic.json();
    expect(license).toMatchObject({ school_id: adminUser.school_id, app_id: "money-bingo", seats: 1, funding_source_id: "grant", ends_at: null });

    expect((await call("POST", `/api/children/${k1.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } })).status).toBe(201);
    expect((await call("POST", `/api/children/${k1.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } })).status).toBe(200);
    const full = await call("POST", `/api/children/${k2.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "no_seats", seats: 1, used: 1, free: 0, needed: 1 });

    // The school sees its pool: 1 seat, 1 used.
    const mine = await call("GET", "/api/school/licenses", { cookie: admin });
    expect(mine.status).toBe(200);
    const rows = await mine.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app_id: "money-bingo", app_name: "Money Bingo", is_current: true, pool: { seats: 1, used: 1, free: 0 } });
    expect(JSON.stringify(rows)).not.toContain("Fake Child");

    // Revoking frees the seat.
    expect((await call("DELETE", `/api/children/${k1.id}/apps/money-bingo`, { cookie: admin })).status).toBe(200);
    expect((await call("POST", `/api/children/${k2.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } })).status).toBe(201);
  });

  it("6. bulk grant is all-or-nothing on seats and only counts children without a live grant", async () => {
    const { cookie: admin, user: adminUser } = await registerAndLogin("p5.bulk.admin@example.test", "school_admin", { school_name: "Test School Bulk" });
    const kids = [];
    for (const n of [1, 2, 3]) kids.push(await createChild(admin, `Fake Child Bulk ${n}`));
    const ids = kids.map((k) => k.id);
    await env.DB.prepare("INSERT INTO school_licenses (id, school_id, app_id, seats, starts_at) VALUES (?, ?, ?, 2, date('now'))")
      .bind(crypto.randomUUID(), adminUser.school_id, "word-builder").run();

    const tooMany = await call("POST", "/api/school/children/apps", { cookie: admin, body: { app_id: "word-builder", child_ids: ids } });
    expect(tooMany.status).toBe(409);
    expect(await tooMany.json()).toMatchObject({ code: "no_seats", seats: 2, used: 0, free: 2, needed: 3 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM child_app_access WHERE app_id = 'word-builder' AND child_id IN (?, ?, ?)").bind(...ids).first()).n).toBe(0);

    const two = await call("POST", "/api/school/children/apps", { cookie: admin, body: { app_id: "word-builder", child_ids: ids.slice(0, 2) } });
    expect(two.status).toBe(200);
    expect(await two.json()).toEqual({ granted: 2, already_granted: 0, app_id: "word-builder" });

    // Re-running with the same two needs 0 new seats: fine even though the pool is full.
    const again = await call("POST", "/api/school/children/apps", { cookie: admin, body: { app_id: "word-builder", child_ids: ids.slice(0, 2) } });
    expect(await again.json()).toEqual({ granted: 0, already_granted: 2, app_id: "word-builder" });
  });

  it("7. an expired license does not count; license validation; licenses are platform_admin only", async () => {
    const { cookie: admin, user: adminUser } = await registerAndLogin("p5.exp.admin@example.test", "school_admin", { school_name: "Test School Expired" });
    const kid = await createChild(admin, "Fake Child Exp");
    await env.DB.prepare("INSERT INTO school_licenses (id, school_id, app_id, seats, starts_at, ends_at) VALUES (?, ?, 'money-bingo', 5, '2025-01-01', '2025-12-31')")
      .bind(crypto.randomUUID(), adminUser.school_id).run();
    const res = await call("POST", `/api/children/${kid.id}/apps`, { cookie: admin, body: { app_id: "money-bingo" } });
    expect(res.status).toBe(409);
    expect((await res.json()).seats).toBe(0);

    const { cookie: ops } = await platformAdmin("p5.exp.ops@example.test");
    const base = `/api/admin/schools/${adminUser.school_id}/licenses`;
    expect((await call("POST", base, { cookie: ops, body: { app_id: "money-bingo", seats: 0 } })).status).toBe(400);
    expect((await call("POST", base, { cookie: ops, body: { app_id: "money-bingo", seats: 1, starts_at: "2026-02-01", ends_at: "2026-01-01" } })).status).toBe(400);
    expect((await call("POST", base, { cookie: ops, body: { app_id: "money-bingo", seats: 1, funding_source_id: "lottery" } })).status).toBe(400);
    expect((await call("POST", base, { cookie: ops, body: { app_id: "no-such-app", seats: 1 } })).status).toBe(404);
    expect((await call("POST", "/api/admin/schools/no-such-school/licenses", { cookie: ops, body: { app_id: "money-bingo", seats: 1 } })).status).toBe(404);
    expect((await call("POST", base, { cookie: admin, body: { app_id: "money-bingo", seats: 1 } })).status).toBe(403);
    const list = await call("GET", base, { cookie: ops });
    expect(list.status).toBe(200);
    expect((await list.json())[0]).toMatchObject({ is_current: false });
    const sources = await call("GET", "/api/admin/funding-sources", { cookie: ops });
    expect((await sources.json()).map((s) => s.id)).toEqual(["district", "grant", "school", "self"]);
  });
});

describe("regrant after expiry (Phase 4 carry-forward)", () => {
  it("8. granting again clears expires_at and the gate opens", async () => {
    const { cookie } = await registerAndLogin("p5.regrant@example.test");
    const child = await createChild(cookie, "Fake Child Regrant");
    expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: ACT1 } })).status).toBe(201);
    await env.DB.prepare("UPDATE child_app_access SET expires_at = datetime('now', '-1 minute') WHERE child_id = ? AND app_id = ?").bind(child.id, ACT1).run();
    expect((await call("GET", `/apps/${ACT1}/play?child_id=${child.id}`, { cookie })).status).toBe(403);

    const again = await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: ACT1 } });
    expect(again.status).toBe(201);
    const row = await again.json();
    expect(row.expires_at).toBeNull();
    expect(row.is_active).toBe(1);
    expect((await call("GET", `/apps/${ACT1}/play?child_id=${child.id}`, { cookie })).status).toBe(200);
  });
});

describe("standards and goals", () => {
  it("9. every Act 1 lesson is tagged; the public endpoint carries no child data; goals fold in progress", async () => {
    const pub = await call("GET", `/apps/${ACT1}/standards`);
    expect(pub.status).toBe(200);
    const { standards } = await pub.json();
    expect(standards).toHaveLength(10);
    const lessons = standards.map((s) => s.lesson_id).sort();
    expect(lessons).toEqual(["01-shapes", "02-numbers", "03-nouns", "04-verbs", "05-colors", "06-emotions", "07-opposites", "08-sequencing", "09-prepositions", "10-math"]);
    expect(standards.find((s) => s.lesson_id === "01-shapes").goal).toBe("Identifies basic shapes");
    expect(Object.keys(standards[0]).sort()).toEqual(["code", "description", "domain", "goal", "id", "lesson_id"]);
    expect((await call("GET", "/apps/no-such-app/standards")).status).toBe(404);
    expect((await call("GET", "/apps/money-bingo/standards")).status).toBe(200); // untagged app: empty list

    const { cookie } = await registerAndLogin("p5.goals@example.test");
    const child = await createChild(cookie, "Fake Child Goals");
    const before = await (await call("GET", `/api/children/${child.id}/goals?app_id=${ACT1}`, { cookie })).json();
    expect(before.met).toBe(0);
    expect(before.goals.every((g) => g.status === "not-started")).toBe(true);

    await call("POST", "/api/progress", { cookie, body: { child_id: child.id, app_id: ACT1, lesson_id: "01-shapes", step_index: 9, completed: true, seconds: 5 } });
    await call("POST", "/api/progress", { cookie, body: { child_id: child.id, app_id: ACT1, lesson_id: "02-numbers", step_index: 2, completed: false, seconds: 5 } });
    const after = await (await call("GET", `/api/children/${child.id}/goals?app_id=${ACT1}`, { cookie })).json();
    expect(after.met).toBe(1);
    expect(after.total).toBe(10);
    expect(after.goals.find((g) => g.lesson_id === "01-shapes")).toMatchObject({ status: "met", evidence: { step_index: 9 } });
    expect(after.goals.find((g) => g.lesson_id === "02-numbers").status).toBe("working");
    expect(JSON.stringify(after)).not.toContain("Fake Child");

    const { cookie: other } = await registerAndLogin("p5.goals.other@example.test");
    expect((await call("GET", `/api/children/${child.id}/goals?app_id=${ACT1}`, { cookie: other })).status).toBe(403);
    expect((await call("GET", `/api/children/${child.id}/goals`, { cookie })).status).toBe(400);
  });
});

describe("nightly rollup", () => {
  it("10. the scheduled handler rolls closed days into usage_daily and the summary reads the rollup", async () => {
    const { cookie } = await registerAndLogin("p5.rollup@example.test");
    const child = await createChild(cookie, "Fake Child Rollup");
    const seed = (date, minutes, activities) => env.DB
      .prepare("INSERT INTO app_usage (child_id, app_id, session_date, minutes_used, seconds_used, activities_completed) VALUES (?, 'money-bingo', ?, ?, ?, ?)")
      .bind(child.id, date, minutes, minutes * 60, activities).run();
    await seed(daysAgo(1), 10, 2);
    await seed(daysAgo(2), 5, 1);
    await seed(daysAgo(0), 3, 1); // today: must not be rolled

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "15 3 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const rolled = await env.DB.prepare("SELECT day, minutes, activities FROM usage_daily WHERE child_id = ? ORDER BY day").bind(child.id).all();
    expect(rolled.results).toEqual([
      { day: daysAgo(2), minutes: 5, activities: 1 },
      { day: daysAgo(1), minutes: 10, activities: 2 },
    ]);

    // Tamper with the live row for a rolled day: the summary must not notice,
    // because it reads usage_daily for that day. Today's live row still counts.
    await env.DB.prepare("UPDATE app_usage SET minutes_used = 999 WHERE child_id = ? AND session_date = ?").bind(child.id, daysAgo(1)).run();
    const summary = await (await call("GET", `/api/usage/summary?child_id=${child.id}`, { cookie })).json();
    expect(summary.totals).toEqual({ minutes: 18, activities: 4 });
    expect(summary.by_day.find((d) => d.date === daysAgo(1)).minutes).toBe(10);

    // Re-rolling corrects the rollup from the live table (upsert).
    const { cookie: ops } = await platformAdmin("p5.rollup.ops@example.test");
    const manual = await call("POST", "/api/admin/usage/rollup", { cookie: ops });
    expect(manual.status).toBe(200);
    expect((await manual.json()).rows).toBeGreaterThanOrEqual(2);
    expect((await env.DB.prepare("SELECT minutes FROM usage_daily WHERE child_id = ? AND day = ?").bind(child.id, daysAgo(1)).first()).minutes).toBe(999);
    expect((await call("POST", "/api/admin/usage/rollup?since=nope", { cookie: ops })).status).toBe(400);
    expect((await call("POST", "/api/admin/usage/rollup", { cookie })).status).toBe(403);

    // The cron run and the manual run are both in the audit log, with counts only.
    const audit = await (await call("GET", "/api/admin/audit?limit=5", { cookie: ops })).json();
    const rollups = audit.filter((a) => a.action === "usage.rollup");
    expect(rollups.length).toBeGreaterThanOrEqual(2);
    expect(rollups.some((a) => a.actor_id === "system")).toBe(true);
  });
});

describe("audit log", () => {
  it("11. admin actions are recorded with ids only; the detail sanitizer drops names", async () => {
    const { cookie: ops, user: opsUser } = await platformAdmin("p5.audit.ops@example.test");
    const created = await call("POST", "/api/admin/schools", { cookie: ops, body: { name: "Fake Audit School", contact_email: "office@example.test" } });
    expect(created.status).toBe(201);
    const school = await created.json();
    const app = await call("POST", "/api/admin/apps", { cookie: ops, body: { name: "Fake Audit App", category: "testing" } });
    expect(app.status).toBe(201);

    const rows = await (await call("GET", "/api/admin/audit?limit=10", { cookie: ops })).json();
    const schoolRow = rows.find((r) => r.action === "school.create" && r.target_id === school.id);
    expect(schoolRow).toMatchObject({ actor_id: opsUser.id, actor_role: "platform_admin", target_type: "school" });
    const appRow = rows.find((r) => r.action === "app.create" && r.target_id === "fake-audit-app");
    expect(appRow.detail.fields).toContain("category");
    expect(JSON.stringify(rows)).not.toContain("Fake Audit");
    expect(JSON.stringify(rows)).not.toContain("office@example.test");

    expect(sanitizeDetail({ child_name: "Fake", email: "x@y", school_id: "s1", count: 2, nested: { a: 1 }, ids: ["a", "b"] }))
      .toBe('{"school_id":"s1","count":2,"ids":["a","b"]}');

    expect((await call("GET", "/api/admin/audit?limit=0", { cookie: ops })).status).toBe(400);
    const { cookie: parent } = await registerAndLogin("p5.audit.parent@example.test");
    expect((await call("GET", "/api/admin/audit", { cookie: parent })).status).toBe(403);
  });
});
