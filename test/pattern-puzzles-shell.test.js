import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/worker.js";
import { PUZZLES } from "../public/apps/pattern-puzzles/engine/puzzles.js";
import { SHAPE_KEYS, FILL_KEYS } from "../public/apps/pattern-puzzles/engine/shapes.js";
import { initialState, itemView, reduce, progressPayload } from "../public/apps/pattern-puzzles/engine/game.js";

// Pattern Puzzles shell, served through the real launch gate, plus the
// progress body the engine builds sent to the real API. Fixtures are fake.
//
// The pool has no DOM, so "a Type 1 puzzle with three choice buttons" is
// asserted on the descriptor js/main.js draws one-for-one (itemView.choices
// -> one <button> each, itemView.cells -> one gridcell each), and the served
// main.js is checked to draw from it.

const PASSWORD = "correct-horse-battery";

async function call(method, path, { body, cookie, ip = "203.0.113.81" } = {}) {
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

let ipCounter = 80;
async function parentWithPatternPuzzles(tag) {
  const email = `pp.${tag}@example.test`;
  expect((await call("POST", "/auth/register", { body: { email, password: PASSWORD, role: "parent" } })).status).toBe(201);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD }, ip: `198.51.100.${++ipCounter % 250}` });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const childRes = await call("POST", "/api/children", { cookie, body: { name: `Fake Child PP ${tag}` } });
  expect(childRes.status).toBe(201);
  const child = await childRes.json();
  expect((await call("POST", `/api/children/${child.id}/apps`, { cookie, body: { app_id: "pattern-puzzles" } })).status).toBe(201);
  return { cookie, child };
}

async function launch(tag) {
  const { cookie, child } = await parentWithPatternPuzzles(tag);
  const res = await call("GET", `/apps/pattern-puzzles/play?child_id=${child.id}`, { cookie });
  expect(res.status).toBe(200);
  return { cookie, child, html: await res.text() };
}

const text = async (path) => {
  const res = await call("GET", path);
  expect(res.status, path).toBe(200);
  return res.text();
};

describe("Pattern Puzzles launch", () => {
  it("renders data-app-id=\"pattern-puzzles\" with the gate's metas and a polite announcer", async () => {
    const { html, child } = await launch("appid");
    expect(html).toContain('data-app-id="pattern-puzzles"');
    expect(html).toContain('<meta name="app-id" content="pattern-puzzles">');
    expect(html).toContain(`<meta name="child-id" content="${child.id}">`);
    expect(html).toMatch(/id="announcer"[^>]*aria-live="polite"/);
    expect(html).toContain('src="/apps/pattern-puzzles/js/main.js"');
  });

  it("opens on a Type 1 puzzle with three choice buttons and a grid with one empty cell", async () => {
    const v = itemView(initialState({ seed: 1 }));
    expect(v.type).toBe(1);
    expect(v.puzzleId).toMatch(/^pp-t1-/);
    expect(v.choices).toHaveLength(3);
    expect(v.rows).toBe(1);
    expect(v.cells.filter((c) => c.missing)).toHaveLength(1);
    expect(v.position).toBe(1);
    expect(v.total).toBe(6);

    const js = await text("/apps/pattern-puzzles/js/main.js");
    expect(js).toContain("const choices = v.choices.map((c) => {");
    expect(js).toContain("const b = el('button', {");
    expect(js).toContain("class: `choice${c.correct ? ' is-answer' : ''}`");
    // The grid is a real ARIA grid in reading order, and the gap says what it is.
    expect(js).toContain("role: 'grid'");
    expect(js).toContain("role: 'row'");
    expect(js).toContain("role: 'gridcell'");
    expect(js).toContain("t('patternPuzzles.missing')");
    expect(js).toContain("tabindex: c.index === focusCell ? '0' : '-1'");
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]) expect(js, k).toContain(`'${k}'`);
  });

  it("does not contain Act 1 lesson markup", async () => {
    const { html } = await launch("noact1");
    for (const marker of ["/apps/act1/", "act1", "lesson-title", 'class="choices"', "prompt-row", "progress-bar", "Sensory Learning", "placeholder"]) {
      expect(html, marker).not.toContain(marker);
    }
  });

  it("main.js is the game: no Act 1 app id, no timer, no score, rule shown and spoken after every answer", async () => {
    const js = await text("/apps/pattern-puzzles/js/main.js");
    expect(js).not.toContain("placeholder");
    expect(js).not.toContain("act1-sensory-learning");
    expect(js).not.toMatch(/Math\.random|setTimeout|setInterval|\bscore\s*[:=]|streak\s*[:=]/);
    expect(js).not.toMatch(/innerHTML/);
    expect(js).toContain("getAppId() !== APP_ID");
    expect(js).toContain("const spoken = [message, ...(v.showRule ? [said(v.rule)] : [])].join(' ');");
    expect(js).toContain("speech.speak(spoken);");
    expect(js).toContain("announce([message, ...ruleLines(v)].join(' '));");
    for (const path of ["engine/game.js", "engine/puzzles.js", "engine/shapes.js", "css/app.css"]) await text(`/apps/pattern-puzzles/${path}`);
    const game = await text("/apps/pattern-puzzles/engine/game.js");
    expect(game).toContain("app_id: 'pattern-puzzles'");
    expect(game).not.toContain("act1-sensory-learning");
  });

  it("every shape in shapes.js has a comment above it saying what tells its silhouette apart", async () => {
    const src = await text("/apps/pattern-puzzles/engine/shapes.js");
    for (const k of SHAPE_KEYS) expect(src, k).toMatch(new RegExp(`  // [^\\n]+\\n(?:  //[^\\n]*\\n)*  ${k}: Object\\.freeze`));
  });

  it("every i18n key the game uses exists in en and es; en rules equal the puzzle data", async () => {
    const en = await (await call("GET", "/i18n/en.json")).json();
    const es = await (await call("GET", "/i18n/es.json")).json();
    const get = (dict, key) => key.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), dict);
    const has = (dict, key) => typeof get(dict, key) === "string";
    const js = await text("/apps/pattern-puzzles/js/main.js");
    const keys = new Set([...js.matchAll(/t\('(patternPuzzles\.[a-z0-9_]+)'/g)].map((m) => m[1]));
    for (const n of [1, 2, 3, 4]) { keys.add(`patternPuzzles.prompt_t${n}`); keys.add(`patternPuzzles.audio_t${n}`); }
    for (const k of SHAPE_KEYS) { keys.add(`patternPuzzles.shape.${k}`); keys.add(`patternPuzzles.shapes.${k}`); }
    for (const f of FILL_KEYS) keys.add(`patternPuzzles.fill.${f}`);
    for (const d of ["up", "right", "down", "left"]) keys.add(`patternPuzzles.dir.${d}`);
    for (const m of ["auto", 1, 2, 3, 4]) keys.add(`patternPuzzles.task_${m}`);
    for (const m of ["on", "off"]) keys.add(`patternPuzzles.rule_${m}`);
    for (const p of PUZZLES) {
      keys.add(`patternPuzzles.rule.${p.id}`);
      expect(get(en, `patternPuzzles.rule.${p.id}`), p.id).toBe(p.rule);
      if (p.type === 3) {
        keys.add(`patternPuzzles.row_rule.${p.id}`);
        keys.add(`patternPuzzles.col_rule.${p.id}`);
        expect(get(en, `patternPuzzles.row_rule.${p.id}`), p.id).toBe(p.rowRule);
        expect(get(en, `patternPuzzles.col_rule.${p.id}`), p.id).toBe(p.colRule);
      }
    }
    expect(keys.size).toBeGreaterThan(100);
    for (const k of keys) {
      expect(has(en, k), `en ${k}`).toBe(true);
      expect(has(es, k), `es ${k}`).toBe(true);
    }
  });

  it("every colour pair the CSS documents meets 4.5:1, and so does every shape colour", async () => {
    const css = await text("/apps/pattern-puzzles/css/app.css");
    const root = css.match(/:root \{([^}]*)\}/)[1];
    const vars = Object.fromEntries([...root.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const [a, b] of [["fg", "bg"], ["muted", "bg"], ["accent", "bg"], ["accent-text", "accent"],
      ["fg", "surface"], ["muted", "surface"], ["accent", "surface"]]) {
      expect(ratio(vars[a], vars[b]), `${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
    }
    const { FILLS } = await import("../public/apps/pattern-puzzles/engine/shapes.js");
    for (const [name, f] of Object.entries(FILLS)) {
      expect(ratio(f.color, vars.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(f.color, vars.surface), `${name} on surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain("--hit: 44px");
    expect(css).toMatch(/\.cell \{[^}]*width: clamp\(var\(--hit\)/);
    expect(css).toMatch(/\.choice \{[^}]*min-width: var\(--hit\); min-height: var\(--hit\)/);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

describe("Pattern Puzzles progress", () => {
  it("the engine's payload is accepted and lands under pattern-puzzles, not Act 1", async () => {
    const { cookie, child } = await parentWithPatternPuzzles("progress");
    let s = initialState({ seed: 6 });
    for (let i = 0; i < 4; i++) {
      s = reduce(s, { type: "PICK", id: s.current.correctId });
      const body = progressPayload({ childId: child.id, ...s.answer, seconds: 5 });
      expect(body.app_id).toBe("pattern-puzzles");
      expect((await call("POST", "/api/progress", { cookie, body })).status).toBe(200);
      s = reduce(s, { type: "NEXT" });
    }
    expect(s.unlocked).toBe(2);

    const mine = await (await call("GET", `/api/children/${child.id}/progress?app_id=pattern-puzzles`, { cookie })).json();
    expect(mine.lessons).toHaveLength(1);
    expect(mine.lessons[0].lesson_id).toBe("type-1");
    expect(Boolean(mine.lessons[0].completed)).toBe(true);
    const next = initialState({ completed: mine.lessons.filter((l) => l.completed).map((l) => l.lesson_id), seed: 1 });
    expect(next.type).toBe(2);
    const act1 = await (await call("GET", `/api/children/${child.id}/progress?app_id=act1-sensory-learning`, { cookie })).json();
    expect(act1.lessons).toEqual([]);
  });
});
