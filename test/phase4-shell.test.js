import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";

// Phase 4 part C: the Act 1 shell, settings panel, reward player and CSS,
// asserted against the files the ASSETS binding really serves, plus the gate
// end to end with the real shell (the HTMLRewriter child-id proof).
// All fixtures are obviously fake (Rule A4).

const PASSWORD = "correct-horse-battery";
const ACT1 = "act1-sensory-learning";

async function call(method, path, { body, cookie, ip = "203.0.113.9" } = {}) {
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

function cookieFrom(response) {
  const setCookie = response.headers.get("Set-Cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

let ipCounter = 100;
async function registerAndLogin(email) {
  const reg = await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } });
  expect(reg.status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(login.status).toBe(200);
  return { user: await login.json(), cookie: cookieFrom(login) };
}

const contentType = (res) => (res.headers.get("Content-Type") || "").toLowerCase();
const text = async (path) => (await call("GET", path)).text();

describe("Act 1 shell assets", () => {
  it("1. the shell HTML carries the empty child-id meta, the module script and the stylesheet", async () => {
    // /apps/act1/ itself is JSON 404 from the router (only the gate serves it);
    // read it straight from the asset binding the gate reads from.
    const res = await env.ASSETS.fetch(new Request("http://example.com/apps/act1/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="child-id" content="">');
    expect((html.match(/name="child-id"/g) || []).length).toBe(1);
    expect(html).toContain('<script type="module" src="/apps/act1/js/shell.js">');
    expect(html).toContain('<link rel="stylesheet" href="/apps/act1/css/app.css">');
    expect(html).not.toMatch(/PLACEHOLDER/);
  });

  it("2. every shell module and the stylesheet are served through the worker with the right type", async () => {
    const files = [
      ["/apps/act1/js/shell.js", "javascript"],
      ["/apps/act1/js/reward-player.js", "javascript"],
      ["/apps/act1/js/settings-panel.js", "javascript"],
      ["/apps/act1/js/svg-dom.js", "javascript"],
      ["/apps/act1/css/app.css", "text/css"],
    ];
    for (const [path, type] of files) {
      const res = await call("GET", path);
      expect(res.status, path).toBe(200);
      expect(contentType(res), path).toContain(type);
    }
    // The shell page and denial page stay behind the gate.
    expect((await call("GET", "/apps/act1/")).status).toBe(404);
    expect((await call("GET", "/apps/act1/denied")).status).toBe(404);
  });

  it("3. app.css has the animations-off, safe-mode and reduced-motion rules and no keyframe on body/html/main", async () => {
    const css = await text("/apps/act1/css/app.css");
    expect(css).toContain(':root[data-animations="off"]');
    expect(css).toContain(':root[data-safe="on"]');
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("--anim-speed");
    expect(css).not.toMatch(/@keyframes[^{]*\{[^}]*(body|html|main)/);
    // Every keyframe is movement only: no background or filter inside any keyframe block.
    const blocks = css.match(/@keyframes[\s\S]*?\}\s*\}/g) || [];
    for (const b of blocks) {
      expect(b).not.toMatch(/background|filter/);
    }
    // No hardcoded durations outside the one --motion token: everything else
    // derives from var(--dur), which divides by --anim-speed.
    const withoutToken = css.split("\n").filter((l) => !/^\s*--motion:/.test(l)).join("\n");
    expect(withoutToken).not.toMatch(/:\s*0?\.\d+s\b|:\s*\d+ms\b/);
  });

  it("4. shell.js consumes the engine and never rolls its own effects or randomness", async () => {
    const js = await text("/apps/act1/js/shell.js");
    expect(js).not.toContain("Math.random");
    expect(js).not.toContain("setInterval");
    expect(js).not.toMatch(/innerHTML\s*=/);
    expect(js).toContain("reduce(state, action)");
    expect(js).toContain("createRewardPlayer");
    expect(js).toContain('meta[name="child-id"]');
    expect(js).not.toContain("localStorage"); // the child id never touches storage
    expect(js).not.toMatch(/stepIndex\s*\+\+|stepIndex\s*\+=/);
  });

  it("5. reward-player.js guards with violatesFlashBudget and creates AudioContext only in unlockAudio", async () => {
    const js = await text("/apps/act1/js/reward-player.js");
    expect(js).toContain("violatesFlashBudget");
    expect(js).toContain("planReward");
    expect(js).not.toContain("Math.random");
    expect(js).not.toContain("setInterval");
    // iterations: 1 everywhere an animation is created.
    expect(js).toContain("iterations: 1");
    expect(js).not.toMatch(/iterations:\s*(Infinity|\d+[2-9]|[2-9])/);
    // AudioContext is constructed in exactly one place, inside unlockAudio.
    const idx = js.indexOf("function unlockAudio");
    const ctor = js.indexOf("new Ctx()");
    expect(idx).toBeGreaterThan(-1);
    expect(ctor).toBeGreaterThan(idx);
    expect((js.match(/new (Ctx|AudioContext)\(/g) || []).length).toBe(1);
  });

  it("6. settings-panel.js defaults safe_mode on and sends it as an explicit boolean", async () => {
    const js = await text("/apps/act1/js/settings-panel.js");
    expect(js).toContain("safe_mode: true");
    expect(js).not.toContain("safe_mode: false");
    expect(js).toContain("safeMode.checked === true");
    expect(js).toContain("act1.settings.v1");
    expect(js).not.toContain("child_name");
  });

  it("7. the gate serves the real shell with the child id injected into the meta tag", async () => {
    const { cookie } = await registerAndLogin("p4c.gate@example.test");
    const created = await call("POST", "/api/children", { cookie, body: { name: "Fake Child Gate" } });
    expect(created.status).toBe(201);
    const child = await created.json();
    const grant = await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: ACT1 } });
    expect(grant.status).toBe(201);

    const page = await call("GET", `/apps/${ACT1}/play?child_id=${child.id}`, { cookie });
    expect(page.status).toBe(200);
    expect(contentType(page)).toContain("text/html");
    const html = await page.text();
    expect(html).toContain(`<meta name="child-id" content="${child.id}"`);
    expect(html).toContain('src="/apps/act1/js/shell.js"');
    expect(html).not.toContain(child.name);
  });

  it("8. an expired grant gets the denial page with no child id in it", async () => {
    const { cookie } = await registerAndLogin("p4c.expired@example.test");
    const child = await (await call("POST", "/api/children", { cookie, body: { name: "Fake Child Exp" } })).json();
    expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: ACT1 } })).status).toBe(201);
    await env.DB
      .prepare("UPDATE child_app_access SET expires_at = datetime('now', '-1 minute') WHERE child_id = ? AND app_id = ?")
      .bind(child.id, ACT1).run();
    const page = await call("GET", `/apps/${ACT1}/play?child_id=${child.id}`, { cookie });
    expect(page.status).toBe(403);
    const html = await page.text();
    expect(html).not.toContain(child.id);
    expect(html).not.toContain('name="child-id"');
  });

  it("10. the companion sprites are served and companion.js stays frame-swap-only", async () => {
    for (const f of ["robot-01-idle", "robot-02-blink", "robot-04-point", "robot-06-nod", "robot-08-cheer", "owl-02-happy", "otter-02-happy"]) {
      const res = await call("GET", `/img/act1/${f}.png`);
      expect(res.status, f).toBe(200);
      expect(contentType(res), f).toContain("image/png");
    }
    const js = await text("/apps/act1/js/companion.js");
    expect(js).toContain("GUIDE_NAME = 'Moby'");
    expect(js).not.toContain("Math.random");
    expect(js).not.toContain("setInterval");
    expect(js).not.toMatch(/style\.(background|filter|opacity)/); // frame swaps and CSS transforms only
    expect(js).not.toMatch(/child_id|childId|child-id/); // the companion never sees a child id
    const css = await text("/apps/act1/css/app.css");
    expect(css).toMatch(/@keyframes companion-breathe[^}]*\{[^}]*transform/);
  });

  it("11. scene backgrounds are served, static, muted, and never override the cards", async () => {
    for (const n of ["solar", "jungle", "speedway"]) {
      const res = await call("GET", `/img/act1/scene-${n}.svg`);
      expect(res.status, n).toBe(200);
      expect(contentType(res), n).toContain("image/svg");
      const svg = await res.text();
      expect(svg).not.toMatch(/<animate|<script|<set\b|begin=/);
      expect(svg.length).toBeLessThan(6000);
    }
    const css = await text("/apps/act1/css/app.css");
    for (const n of ["solar", "jungle", "speedway"]) expect(css).toContain(`:root[data-scene="${n}"] body`);
    expect(css).toContain(':root[data-safe="on"][data-scene]');
    expect(css).toContain(':root[data-contrast="high"] body { background-image: none !important; }');
  });

  it("9. the parent dashboard and app detail launch through the gate URL, never the app folder", async () => {
    const parent = await text("/js/views/parent.js");
    expect(parent).toContain("/play?child_id=");
    expect(parent).not.toContain("/apps/act1/");
    const detail = await text("/js/views/app-detail.js");
    expect(detail).toContain("/play?child_id=");
    expect(detail).not.toContain("/apps/act1/");
  });
});
