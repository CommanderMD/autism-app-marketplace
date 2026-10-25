import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Build A: per-app shell routing and app-id plumbing.
// Regression for "every app is the same game": the launch gate used to serve
// /apps/act1/ for every app id. All fixtures are obviously fake (Rule A4).
const PASSWORD = "correct-horse-battery";
const DENIAL_TEXT = "This app is not available right now";

// app id -> what that app's own shell must contain.
const APPS = [
  { id: "act1-sensory-learning", dir: "act1", title: "Act 1 — Sensory Learning", script: "/apps/act1/js/shell.js" },
  { id: "money-bingo", dir: "money-bingo", title: "Money Bingo", script: "/apps/money-bingo/js/main.js" },
  { id: "word-builder", dir: "word-builder", title: "Word Builder", script: "/apps/word-builder/js/main.js" },
  { id: "emotion-match", dir: "emotion-match", title: "Emotion Matcher", script: "/apps/emotion-match/js/main.js" },
  { id: "pattern-puzzles", dir: "pattern-puzzles", title: "Pattern Puzzles", script: "/apps/pattern-puzzles/js/main.js" },
];

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
let ipCounter = 100;
async function login(email) {
  const res = await call("POST", "/auth/login", {
    body: { email, password: PASSWORD },
    ip: `198.51.100.${++ipCounter % 250}`,
  });
  expect(res.status).toBe(200);
  return { user: await res.json(), cookie: cookieFrom(res) };
}

async function registerAndLogin(email) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } });
  expect(reg.status).toBe(201);
  return login(email);
}

// Seeds a platform admin directly, as scripts/bootstrap-admin.mjs would.
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

async function grant(cookie, childId, appId) {
  const res = await call("POST", `/api/children/${childId}/apps`, { cookie, body: { app_id: appId } });
  expect(res.status).toBe(201);
}

const playPath = (childId, appId) => `/apps/${appId}/play?child_id=${childId}`;

function metaContent(html, name) {
  const match = html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
  return match ? match[1] : null;
}

// The gate injects child-id and app-id, so two launches always differ in those
// two attributes. Blank them so the comparison is about the shell itself.
function shellOnly(html) {
  return html.replace(/<meta name="(child-id|app-id)" content="[^"]*"/g, '<meta name="$1" content=""');
}

// One parent, one child with a live grant for all five apps.
async function launchAll(tag) {
  const { cookie } = await registerAndLogin(`ga.${tag}@example.test`);
  const child = await createChild(cookie, `Fake Child GA ${tag}`);
  for (const app of APPS) await grant(cookie, child.id, app.id);
  const pages = {};
  for (const app of APPS) {
    const res = await call("GET", playPath(child.id, app.id), { cookie });
    pages[app.id] = { status: res.status, headers: res.headers, html: await res.text() };
  }
  return { child, pages };
}

describe("per-app launch gate", () => {
  for (const app of APPS) {
    it(`${app.id}: an authorised launch serves its own shell with app-id set to ${app.id}`, async () => {
      const { cookie } = await registerAndLogin(`ga.one.${app.dir}@example.test`);
      const child = await createChild(cookie, `Fake Child GA ${app.dir}`);
      await grant(cookie, child.id, app.id);

      const res = await call("GET", playPath(child.id, app.id), { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const html = await res.text();
      expect(html).toContain(`<title>${app.title}</title>`);
      expect(html).toContain(`src="${app.script}"`);
      expect(html).toContain(`href="/apps/${app.dir}/css/app.css"`);
      expect(metaContent(html, "app-id")).toBe(app.id);
      expect(metaContent(html, "child-id")).toBe(child.id);
      expect(html).not.toContain(child.name);
    });
  }

  it("no two apps serve the same shell", async () => {
    const { pages } = await launchAll("pairwise");
    for (const app of APPS) expect(pages[app.id].status).toBe(200);
    for (let i = 0; i < APPS.length; i++) {
      for (let j = i + 1; j < APPS.length; j++) {
        const a = APPS[i].id;
        const b = APPS[j].id;
        expect(
          shellOnly(pages[a].html) === shellOnly(pages[b].html),
          `two different apps served the same shell: ${a} and ${b}`,
        ).toBe(false);
      }
    }
  });

  it("an active app with no shell mapping is a JSON 404, not Act 1's page", async () => {
    const admin = await platformAdmin("ga.ops@example.test");
    const created = await call("POST", "/api/admin/apps", {
      cookie: admin.cookie,
      body: { id: "ga-unmapped-fake-app", name: "GA Unmapped Fake App", category: "testing" },
    });
    expect(created.status).toBe(201);
    expect((await created.json()).is_active).toBeTruthy();

    const { cookie } = await registerAndLogin("ga.unmapped@example.test");
    const child = await createChild(cookie, "Fake Child GA Unmapped");
    await grant(cookie, child.id, "ga-unmapped-fake-app");

    const res = await call("GET", playPath(child.id, "ga-unmapped-fake-app"), { cookie });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "App not found" });
  });

  it("a child granted only emotion-match cannot reach money-bingo", async () => {
    const { cookie } = await registerAndLogin("ga.onlyemotion@example.test");
    const child = await createChild(cookie, "Fake Child GA Emotion");
    await grant(cookie, child.id, "emotion-match");

    const allowed = await call("GET", playPath(child.id, "emotion-match"), { cookie });
    expect(allowed.status).toBe(200);
    expect(metaContent(await allowed.text(), "app-id")).toBe("emotion-match");

    const denied = await call("GET", playPath(child.id, "money-bingo"), { cookie });
    expect(denied.status).toBe(403);
    const deniedText = await denied.text();
    expect(deniedText).toContain(DENIAL_TEXT);
    expect(deniedText).not.toContain("Money Bingo");
    expect(deniedText).not.toContain(child.id);
  });
});

describe("per-app asset allowlist", () => {
  it("serves each new app's module and stylesheet, but never its shell around the gate", async () => {
    for (const app of APPS.filter((a) => a.dir !== "act1")) {
      const js = await call("GET", `/apps/${app.dir}/js/main.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get("Content-Type")).toContain("javascript");
      const css = await call("GET", `/apps/${app.dir}/css/app.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get("Content-Type")).toContain("text/css");

      // /apps/<dir>/ normalises to /apps/<id>, the JSON app detail: never the shell.
      const dirRoot = await call("GET", `/apps/${app.dir}/`);
      expect(dirRoot.headers.get("Content-Type")).toContain("application/json");
      expect(await dirRoot.text()).not.toContain("<title>");
      for (const path of [`/apps/${app.dir}/index.html`, `/apps/${app.dir}/js/missing.js`]) {
        const res = await call("GET", path);
        expect(res.status).toBe(404);
        expect(res.headers.get("Content-Type")).toContain("application/json");
      }
    }
    // A directory outside the allowlist stays JSON 404.
    expect((await call("GET", "/apps/not-an-app/js/main.js")).status).toBe(404);
  });
});

describe("shells read the app id from the page", () => {
  it("settings-panel.js has no hardcoded APP_ID export and reads meta[name=app-id]", async () => {
    const js = await (await call("GET", "/apps/act1/js/settings-panel.js")).text();
    expect(js).not.toMatch(/export const APP_ID\s*=/);
    expect(js).toContain('meta[name="app-id"]');
    expect(js).toMatch(/export function getAppId\(/);
  });

  it("act1 index.html has an empty app-id meta; dev.html names Act 1 explicitly", async () => {
    const index = await (await env.ASSETS.fetch(new Request("http://example.com/apps/act1/"))).text();
    expect(index).toContain('<meta name="app-id" content="">');
    const dev = await call("GET", "/apps/act1/dev");
    expect(dev.status).toBe(200);
    expect(await dev.text()).toContain('<meta name="app-id" content="act1-sensory-learning">');
  });
});
