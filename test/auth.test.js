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

// Returns "name=value" from Set-Cookie, ready to send back as a Cookie header.
function cookieFrom(response) {
  const setCookie = response.headers.get("Set-Cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

async function registerAndLogin(email, role = "parent", extra = {}) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role, ...extra } });
  expect(reg.status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return { user: await login.json(), cookie: cookieFrom(login) };
}

describe("migration 003_auth", () => {
  it("adds FKs to children and parents, keeps apps and indexes", async () => {
    const childFks = await env.DB.prepare("SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('children') ORDER BY \"from\"").all();
    expect(childFks.results).toEqual([
      { table: "parents", from: "parent_id", to: "id" },
      { table: "schools", from: "school_id", to: "id" },
    ]);

    const parentFks = await env.DB.prepare("SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('parents')").all();
    expect(parentFks.results).toEqual([{ table: "users", from: "id", to: "id" }]);

    const userFks = await env.DB.prepare("SELECT \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('users')").all();
    expect(userFks.results).toEqual([{ table: "schools", from: "school_id", to: "id" }]);

    const apps = await env.DB.prepare("SELECT COUNT(*) AS n FROM apps").first();
    expect(apps.n).toBe(5);

    // Every named index from 001_init.sql survives the rebuild (auto PK indexes excluded).
    const idx = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all();
    expect(idx.results.map((r) => r.name)).toEqual([
      "idx_app_usage_app",
      "idx_app_usage_child",
      "idx_app_usage_date",
      "idx_child_app_access_app",
      "idx_child_app_access_child",
      "idx_children_parent",
      "idx_children_school",
      "idx_users_school",
    ]);

    const leftovers = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name IN ('children_new', 'parents_new')").all();
    expect(leftovers.results).toEqual([]);
  });

  it("rejects an invalid role at the database level", async () => {
    await expect(
      env.DB.prepare("INSERT INTO users (id, email, password_hash, role) VALUES ('x', 'x@example.test', 'h', 'child')").run()
    ).rejects.toThrow(/CHECK/);
  });
});

describe("auth + children flow", () => {
  it("register -> login -> child -> 200 own / 403 other -> logout -> 401", async () => {
    // Register + login parent A
    const regA = await call("POST", "/auth/register", {
      body: { email: "parent.a@example.test", password: PASSWORD, role: "parent" },
    });
    expect(regA.status).toBe(201);
    const regABody = await regA.json();
    expect(regABody).toMatchObject({ email: "parent.a@example.test", role: "parent", school_id: null });
    expect(regABody.password_hash).toBeUndefined();

    // Profile row has the same id as the users row
    const profile = await env.DB.prepare("SELECT id FROM parents WHERE id = ?").bind(regABody.id).first();
    expect(profile).not.toBeNull();

    // Stored hash is PBKDF2, never the plaintext
    const stored = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(regABody.id).first();
    expect(stored.password_hash).toMatch(/^pbkdf2\$sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(stored.password_hash).not.toContain(PASSWORD);

    const loginA = await call("POST", "/auth/login", {
      body: { email: "parent.a@example.test", password: PASSWORD },
    });
    expect(loginA.status).toBe(200);
    const setCookie = loginA.headers.get("Set-Cookie");
    expect(setCookie).toMatch(/^__Host-sid=[0-9a-f]{64}; /);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"]) {
      expect(setCookie).toContain(attr);
    }
    const cookieA = cookieFrom(loginA);

    // Session is in KV with the agreed shape
    const sessionId = cookieA.split("=")[1];
    const session = await env.SESSIONS.get(`session:${sessionId}`, "json");
    expect(session).toMatchObject({ userId: regABody.id, role: "parent" });
    expect(typeof session.createdAt).toBe("number");

    const me = await call("GET", "/auth/me", { cookie: cookieA });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ id: regABody.id, email: "parent.a@example.test", role: "parent", school_id: null });

    // Create child; parent_id in the body must be ignored
    const create = await call("POST", "/api/children", {
      cookie: cookieA,
      body: { name: "Test Child A", birth_date: "2019-01-01", parent_id: "someone-else" },
    });
    expect(create.status).toBe(201);
    const child = await create.json();
    expect(child.name).toBe("Test Child A");
    expect(child.parent_id).toBe(regABody.id);

    // GET own child -> 200, and it appears in the scoped list
    const own = await call("GET", `/api/children/${child.id}`, { cookie: cookieA });
    expect(own.status).toBe(200);
    expect((await own.json()).id).toBe(child.id);

    const listA = await call("GET", "/api/children", { cookie: cookieA });
    expect((await listA.json()).map((c) => c.id)).toEqual([child.id]);

    // Grant an app, idempotently
    const grant1 = await call("POST", `/api/children/${child.id}/apps`, { cookie: cookieA, body: { app_id: "money-bingo" } });
    expect(grant1.status).toBe(201);
    expect(await grant1.json()).toMatchObject({ child_id: child.id, app_id: "money-bingo", granted_by: regABody.id });
    const grant2 = await call("POST", `/api/children/${child.id}/apps`, { cookie: cookieA, body: { app_id: "money-bingo" } });
    expect(grant2.status).toBe(200);
    const accessRows = await env.DB.prepare("SELECT COUNT(*) AS n FROM child_app_access WHERE child_id = ?").bind(child.id).first();
    expect(accessRows.n).toBe(1);

    // Second parent: 403 on parent A's child, 404 on a missing one, empty list
    const { cookie: cookieB } = await registerAndLogin("parent.b@example.test");
    const other = await call("GET", `/api/children/${child.id}`, { cookie: cookieB });
    expect(other.status).toBe(403);
    const otherBody = await other.json();
    expect(otherBody.name).toBeUndefined();

    const missing = await call("GET", "/api/children/does-not-exist", { cookie: cookieB });
    expect(missing.status).toBe(404);

    const listB = await call("GET", "/api/children", { cookie: cookieB });
    expect(await listB.json()).toEqual([]);

    const grantB = await call("POST", `/api/children/${child.id}/apps`, { cookie: cookieB, body: { app_id: "word-builder" } });
    expect(grantB.status).toBe(403);

    // Logout parent A -> session gone, cookie cleared, 401 afterwards
    const logout = await call("POST", "/auth/logout", { cookie: cookieA });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await env.SESSIONS.get(`session:${sessionId}`)).toBeNull();

    const after = await call("GET", "/api/children", { cookie: cookieA });
    expect(after.status).toBe(401);
    const meAfter = await call("GET", "/auth/me", { cookie: cookieA });
    expect(meAfter.status).toBe(401);
  });

  it("school_admin sees only their school's children; parent cannot pick a school", async () => {
    const { user: admin1, cookie: adminCookie1 } = await registerAndLogin("admin.one@example.test", "school_admin", { school_name: "Test School One" });
    const { cookie: adminCookie2 } = await registerAndLogin("admin.two@example.test", "school_admin", { school_name: "Test School Two" });
    expect(admin1.school_id).toBeTruthy();

    const create = await call("POST", "/api/children", { cookie: adminCookie1, body: { name: "Test Child S" } });
    expect(create.status).toBe(201);
    const child = await create.json();
    expect(child.school_id).toBe(admin1.school_id);
    expect(child.parent_id).toBeNull();

    expect((await call("GET", `/api/children/${child.id}`, { cookie: adminCookie1 })).status).toBe(200);
    expect((await call("GET", `/api/children/${child.id}`, { cookie: adminCookie2 })).status).toBe(403);
    expect(await (await call("GET", "/api/children", { cookie: adminCookie2 })).json()).toEqual([]);

    // Admin two cannot create a child in school one
    const cross = await call("POST", "/api/children", { cookie: adminCookie2, body: { name: "Test Child X", school_id: admin1.school_id } });
    expect(cross.status).toBe(403);

    // A parent cannot attach their child to an arbitrary school
    const { cookie: parentCookie } = await registerAndLogin("parent.c@example.test");
    const parentCross = await call("POST", "/api/children", { cookie: parentCookie, body: { name: "Test Child C", school_id: admin1.school_id } });
    expect(parentCross.status).toBe(403);
  });

  it("platform_admin cannot self-register and sees all children", async () => {
    const reg = await call("POST", "/auth/register", {
      body: { email: "root@example.test", password: PASSWORD, role: "platform_admin" },
    });
    expect(reg.status).toBe(400);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE email = 'root@example.test'").first()).toBeNull();

    // Seed a platform admin directly, as an operator would
    const { cookie: parentCookie } = await registerAndLogin("parent.d@example.test");
    await call("POST", "/api/children", { cookie: parentCookie, body: { name: "Test Child D" } });

    const { user: tmp } = await registerAndLogin("ops@example.test");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM parents WHERE id = ?").bind(tmp.id),
      env.DB.prepare("UPDATE users SET role = 'platform_admin' WHERE id = ?").bind(tmp.id),
    ]);
    const login = await call("POST", "/auth/login", { body: { email: "ops@example.test", password: PASSWORD } });
    const list = await call("GET", "/api/children", { cookie: cookieFrom(login) });
    expect(list.status).toBe(200);
    expect((await list.json()).map((c) => c.name)).toEqual(["Test Child D"]);
  });

  it("rejects duplicate email, weak password, and bad JSON", async () => {
    const body = { email: "dup@example.test", password: PASSWORD, role: "parent" };
    expect((await call("POST", "/auth/register", { body })).status).toBe(201);
    expect((await call("POST", "/auth/register", { body: { ...body, email: "DUP@example.test" } })).status).toBe(409);
    expect((await call("POST", "/auth/register", { body: { ...body, email: "weak@example.test", password: "short" } })).status).toBe(400);
    const bad = new Request("http://example.com/auth/register", { method: "POST", body: "{not json" });
    const ctx = createExecutionContext();
    expect((await worker.fetch(bad, env, ctx)).status).toBe(400);
  });

  it("returns 401 for every /api route without a session; /apps stays public", async () => {
    expect((await call("GET", "/api/children")).status).toBe(401);
    expect((await call("POST", "/api/children", { body: { name: "Test Child Z" } })).status).toBe(401);
    expect((await call("GET", "/api/children/anything")).status).toBe(401);
    expect((await call("POST", "/api/children/anything/apps", { body: { app_id: "money-bingo" } })).status).toBe(401);
    expect((await call("GET", "/api/parents")).status).toBe(401);
    expect((await call("GET", "/api/app_usage")).status).toBe(401);
    expect((await call("GET", "/api/children", { cookie: "__Host-sid=" + "a".repeat(64) })).status).toBe(401);
    expect((await call("GET", "/auth/me")).status).toBe(401);
    expect((await call("GET", "/apps")).status).toBe(200);
  });

  it("failed login returns the same generic 401 for wrong password and unknown email, after ~1s", async () => {
    await call("POST", "/auth/register", { body: { email: "parent.e@example.test", password: PASSWORD, role: "parent" } });

    let start = Date.now();
    const wrong = await call("POST", "/auth/login", { body: { email: "parent.e@example.test", password: "wrong-password-123" } });
    const wrongMs = Date.now() - start;

    start = Date.now();
    const unknown = await call("POST", "/auth/login", { body: { email: "nobody@example.test", password: "wrong-password-123" } });
    const unknownMs = Date.now() - start;

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
    expect(wrongMs).toBeGreaterThanOrEqual(950);
    expect(unknownMs).toBeGreaterThanOrEqual(950);
  }, 15000);
});

describe("migration 003_auth on a populated database", () => {
  const migration = (name) => env.TEST_MIGRATIONS.find((m) => m.name.startsWith(name));
  const run = (queries) => env.DB.batch(queries.map((q) => env.DB.prepare(q)));

  // Rebuilds the pre-003 schema with data in it, then applies 003 exactly as
  // D1 does (one batch/transaction). Storage is reset after each test.
  async function resetToPhase1() {
    await run([
      "PRAGMA defer_foreign_keys = ON",
      "DROP TABLE app_usage", "DROP TABLE child_app_access", "DROP TABLE children",
      "DROP TABLE parents", "DROP TABLE users", "DROP TABLE schools", "DROP TABLE apps",
    ]);
    await run(migration("001").queries);
    await run(migration("002").queries);
  }

  it("preserves children, access, usage and app rows", async () => {
    await resetToPhase1();
    await run([
      "INSERT INTO schools (id, name) VALUES ('s1', 'Test School')",
      "INSERT INTO children (id, name, school_id) VALUES ('c1', 'Test Child A', 's1')",
      "INSERT INTO children (id, name) VALUES ('c2', 'Test Child B')",
      "INSERT INTO child_app_access (child_id, app_id, granted_by) VALUES ('c1', 'money-bingo', 'x')",
      "INSERT INTO app_usage (child_id, app_id, session_date) VALUES ('c1', 'money-bingo', '2026-01-01')",
    ]);

    await run(migration("003").queries);

    const count = async (t) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
    expect(await count("children")).toBe(2);
    expect(await count("child_app_access")).toBe(1);
    expect(await count("app_usage")).toBe(1);
    expect(await count("apps")).toBe(5);
    const c1 = await env.DB.prepare("SELECT name, school_id FROM children WHERE id = 'c1'").first();
    expect(c1).toEqual({ name: "Test Child A", school_id: "s1" });
    const access = await env.DB.prepare("SELECT id, child_id, app_id FROM child_app_access").first();
    expect(access).toEqual({ id: 1, child_id: "c1", app_id: "money-bingo" });
    const fkCheck = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(fkCheck.results).toEqual([]);
    const stash = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_stash_%' OR name LIKE '%_new'").all();
    expect(stash.results).toEqual([]);
  });

  it("refuses (rolls back) if a legacy parents row has no users row", async () => {
    await resetToPhase1();
    await run(["INSERT INTO parents (id, name) VALUES ('p1', 'Test Parent')"]);
    await expect(run(migration("003").queries)).rejects.toThrow(/FOREIGN KEY/);
    // Rolled back: old parents table and row still there, users not created
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM parents").first()).n).toBe(1);
    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").first()).toBeNull();
  });
});

describe("login rate limit", () => {
  it("allows 10 logins per minute per IP, then 429 with Retry-After", async () => {
    await call("POST", "/auth/register", { body: { email: "parent.f@example.test", password: PASSWORD, role: "parent" } });
    const body = { email: "parent.f@example.test", password: PASSWORD };
    const ip = "198.51.100.7";

    for (let i = 0; i < 10; i++) {
      expect((await call("POST", "/auth/login", { body, ip })).status).toBe(200);
    }
    const limited = await call("POST", "/auth/login", { body, ip });
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const counter = await env.SESSIONS.get(`ratelimit:login:${ip}`, "json");
    expect(counter.count).toBe(11);

    // A different IP is unaffected
    expect((await call("POST", "/auth/login", { body, ip: "198.51.100.8" })).status).toBe(200);
  }, 20000);
});
