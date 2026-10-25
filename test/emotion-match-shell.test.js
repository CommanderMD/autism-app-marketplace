import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { ITEMS } from "../public/apps/emotion-match/engine/items.js";
import { FACE_SVG, EMOTIONS, INTENSITIES } from "../public/apps/emotion-match/engine/faces.js";
import { initialState, itemView, reduce, progressPayload } from "../public/apps/emotion-match/engine/game.js";

// Emotion Matcher shell, served through the real launch gate, plus the
// progress body the engine builds sent to the real API. Fixtures are fake.
//
// The pool has no DOM, so "a Type 1 item with three choice buttons" is
// asserted on the descriptor js/main.js draws one-for-one (itemView.choices ->
// one <button> each), and the served main.js is checked to draw from it.

const PASSWORD = "correct-horse-battery";

async function call(method, path, { body, cookie, ip = "203.0.113.71" } = {}) {
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

let ipCounter = 70;
async function parentWithEmotionMatch(tag) {
  const email = `em.${tag}@example.test`;
  expect((await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } })).status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const childRes = await call("POST", "/api/children", { cookie, body: { name: `Fake Child EM ${tag}` } });
  expect(childRes.status).toBe(201);
  const child = await childRes.json();
  expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: "emotion-match" } })).status).toBe(201);
  return { cookie, child };
}

async function launch(tag) {
  const { cookie, child } = await parentWithEmotionMatch(tag);
  const res = await call("GET", `/apps/emotion-match/play?child_id=${child.id}`, { cookie });
  expect(res.status).toBe(200);
  return { cookie, child, html: await res.text() };
}

describe("Emotion Matcher launch", () => {
  it("renders data-app-id=\"emotion-match\" with the gate's metas and a polite announcer", async () => {
    const { html, child } = await launch("appid");
    expect(html).toContain('data-app-id="emotion-match"');
    expect(html).toContain('<meta name="app-id" content="emotion-match">');
    expect(html).toContain(`<meta name="child-id" content="${child.id}">`);
    expect(html).toMatch(/id="announcer"[^>]*aria-live="polite"/);
    expect(html).toContain('src="/apps/emotion-match/js/main.js"');
  });

  it("opens on a Type 1 item with three choice buttons", async () => {
    const v = itemView(initialState({ seed: 1 }));
    expect(v.type).toBe(1);
    expect(v.kind).toBe("word");
    expect(v.face).toMatch(/-quite$/);
    expect(v.choices).toHaveLength(3);
    expect(v.position).toBe(1);
    expect(v.total).toBe(8);

    const js = await (await call("GET", "/apps/emotion-match/js/main.js")).text();
    expect(js).toContain("const choices = v.choices.map((c) => {");
    expect(js).toContain("el('button', {");
    expect(js).toContain("class: `choice choice-${c.kind}");
    expect(js).toContain("'aria-pressed': c.picked ? 'true' : 'false'");
  });

  it("does not contain Act 1 lesson markup", async () => {
    const { html } = await launch("noact1");
    for (const marker of ["/apps/act1/", "act1", "lesson-title", 'class="choices"', "prompt-row", "progress-bar", "Sensory Learning"]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  it("main.js is the game, not the placeholder: no Act 1 app id, no timer, no score, positional names before the reveal", async () => {
    const js = await (await call("GET", "/apps/emotion-match/js/main.js")).text();
    expect(js).not.toContain("placeholder");
    expect(js).not.toContain("act1-sensory-learning");
    expect(js).not.toMatch(/Math\.random|setTimeout|setInterval|\bscore\s*[:=]|streak\s*[:=]/);
    expect(js).not.toMatch(/innerHTML/);
    expect(js).toContain("getAppId() !== APP_ID");
    // Before the reveal a face choice is named by position only.
    expect(js).toContain("else label = t('emotionMatch.choice_n', { n: c.n });");
    expect(js).toContain("if (c.revealed) label = t('emotionMatch.choice_named'");
    for (const path of ["engine/game.js", "engine/items.js", "engine/faces.js", "css/app.css"]) {
      const asset = await call("GET", `/apps/emotion-match/${path}`);
      expect(asset.status, path).toBe(200);
    }
  });

  it("every i18n key the game uses exists in en and es", async () => {
    const en = await (await call("GET", "/i18n/en.json")).json();
    const es = await (await call("GET", "/i18n/es.json")).json();
    const has = (dict, key) => typeof key.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), dict) === "string";
    const js = await (await call("GET", "/apps/emotion-match/js/main.js")).text();
    const keys = new Set([...js.matchAll(/t\('(emotionMatch\.[a-z_]+)'/g)].map((m) => m[1]));
    for (const i of ITEMS) for (const k of [i.prompt, i.audio, i.scenario].filter(Boolean)) keys.add(k);
    for (const k of ["emotionMatch.prompt_intensity", "emotionMatch.audio_intensity"]) keys.add(k);
    for (const e of EMOTIONS) keys.add(`emotionMatch.word.${e}`);
    for (const a of INTENSITIES) keys.add(`emotionMatch.amount.${a}`);
    for (const f of Object.keys(FACE_SVG)) keys.add(`emotionMatch.face.${f}`);
    for (const m of ["auto", 1, 2, 3]) keys.add(`emotionMatch.task_${m}`);
    for (const m of ["off", "on"]) keys.add(`emotionMatch.intensity_${m}`);
    expect(keys.size).toBeGreaterThan(60);
    for (const k of keys) {
      expect(has(en, k), `en ${k}`).toBe(true);
      expect(has(es, k), `es ${k}`).toBe(true);
    }
    // Face descriptions never name the emotion they describe.
    for (const f of Object.keys(FACE_SVG)) {
      const emotion = f.split("-")[0];
      expect(en.emotionMatch.face[f].toLowerCase(), f).not.toContain(emotion);
      expect(es.emotionMatch.face[f].toLowerCase(), f).not.toContain(es.emotionMatch.word[emotion]);
    }
  });

  it("every colour pair the CSS documents meets 4.5:1", async () => {
    const css = await (await call("GET", "/apps/emotion-match/css/app.css")).text();
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
    for (const [a, b] of [["fg", "bg"], ["muted", "bg"], ["accent", "bg"], ["accent-text", "accent"],
      ["fg", "surface"], ["muted", "surface"], ["accent", "surface"]]) {
      expect(ratio(a, b), `${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain("--hit: 44px");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

describe("Emotion Matcher progress", () => {
  it("the engine's payload is accepted and lands under emotion-match, not Act 1", async () => {
    const { cookie, child } = await parentWithEmotionMatch("progress");
    let s = initialState({ seed: 6 });
    for (let i = 0; i < 4; i++) {
      s = reduce(s, { type: "PICK", id: s.current.correctId });
      const body = progressPayload({ childId: child.id, ...s.answer, seconds: 5 });
      expect(body.app_id).toBe("emotion-match");
      expect((await call("POST", "/api/progress", { cookie, body })).status).toBe(200);
      s = reduce(s, { type: "NEXT" });
    }
    expect(s.unlocked).toBe(2);

    const mine = await (await call("GET", `/api/children/${child.id}/progress?app_id=emotion-match`, { cookie })).json();
    expect(mine.lessons).toHaveLength(1);
    expect(mine.lessons[0].lesson_id).toBe("type-1");
    expect(Boolean(mine.lessons[0].completed)).toBe(true);
    const next = initialState({ completed: mine.lessons.filter((l) => l.completed).map((l) => l.lesson_id), seed: 1 });
    expect(next.type).toBe(2);
    const act1 = await (await call("GET", `/api/children/${child.id}/progress?app_id=act1-sensory-learning`, { cookie })).json();
    expect(act1.lessons).toEqual([]);
  });
});
