import { describe, it, expect } from "vitest";
import {
  SHAPES, SHAPE_KEYS, FILLS, shapeSvg, countSvg, sidesOf, normaliseCell,
} from "../public/apps/pattern-puzzles/engine/shapes.js";
import {
  PUZZLES, TASK_TYPES, PATTERNS, GROWTHS, validatePuzzles, puzzlesOfType, nextCount,
} from "../public/apps/pattern-puzzles/engine/puzzles.js";
import {
  APP_ID, SESSION_LENGTH, DEFAULT_DIALS,
  shouldUnlock, unlockedFromCompleted, buildSession, initialState, reduce, progressPayload, itemView, lessonId,
} from "../public/apps/pattern-puzzles/engine/game.js";

// Pattern Puzzles engine: shapes, content, validator and game rules, in Node.

const clone = (x) => JSON.parse(JSON.stringify(x));
const puzzle = (id) => clone(PUZZLES.find((p) => p.id === id));
const rejects = (mutate, message) => {
  const list = clone(PUZZLES);
  mutate(list);
  expect(() => validatePuzzles(list)).toThrow(message);
};
const byId = (list, id) => list.find((p) => p.id === id);
const wrongId = (s) => s.current.choices.find((c) => c.id !== s.current.correctId).id;
const answer = (s, right) => reduce(reduce(s, { type: "PICK", id: right ? s.current.correctId : wrongId(s) }), { type: "NEXT" });

// An independent checker for the four repeating units, written from the
// brief rather than reusing the engine's continuesPattern: AB, AAB, ABB, ABC.
const UNITS = { AB: "AB", AAB: "AAB", ABB: "ABB", ABC: "ABC" };
const key = (cell) => {
  const c = typeof cell === "string" ? { shape: cell } : cell;
  return [c.shape, c.fill ?? "solid", c.size ?? "big", c.turn ?? 0].join("/");
};
function followsUnit(row, unit) {
  const letters = UNITS[unit];
  const meaning = {};
  for (let i = 0; i < row.length; i++) {
    const letter = letters[i % letters.length];
    const k = key(row[i]);
    if (meaning[letter] === undefined) {
      if (Object.values(meaning).includes(k)) return false; // two letters, one cell
      meaning[letter] = k;
    } else if (meaning[letter] !== k) return false;
  }
  return Object.keys(meaning).length === new Set(letters).size;
}

describe("shapes", () => {
  it("at least the ten required keys, frozen", () => {
    for (const k of ["circle", "square", "triangle", "star", "heart", "diamond", "hexagon", "cross", "moon", "arrow"]) {
      expect(SHAPE_KEYS, k).toContain(k);
    }
    expect(Object.isFrozen(SHAPES)).toBe(true);
    expect(Object.isFrozen(SHAPES.circle)).toBe(true);
  });

  it("every outline is different, so silhouettes alone tell them apart", () => {
    const paths = SHAPE_KEYS.map((k) => SHAPES[k].path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(sidesOf("square")).toBe(4);
    expect(sidesOf("triangle")).toBe(3);
    expect(sidesOf("circle")).toBeNull();
  });

  it("pictures are inert, aria-hidden, 100x100, 2px currentColor ink", () => {
    const all = [];
    for (const k of SHAPE_KEYS) for (const f of Object.keys(FILLS)) all.push([`${k}/${f}`, shapeSvg({ shape: k, fill: f }, "t")]);
    all.push(["count", countSvg("star", 7, "t")]);
    for (const [name, svg] of all) {
      expect(svg, name).toMatch(/^<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" color="#[0-9a-f]{6}">/);
      expect(svg, name).not.toMatch(/<script|<image|<text|href|http|\son[a-z]+=|style=/i);
      expect([...svg.matchAll(/stroke="([^"]+)"/g)].every((m) => m[1] === "currentColor"), name).toBe(true);
      expect([...svg.matchAll(/stroke-width="([^"]+)"/g)].every((m) => m[1] === "2"), name).toBe(true);
      expect([...svg.matchAll(/ fill="([^"]+)"/g)].every((m) => /^(currentColor|none|url\(#pp-(st|dt)-t\))$/.test(m[1])), name).toBe(true);
    }
    // Count pictures draw exactly `count` shapes; nothing past the screen limit.
    expect((countSvg("star", 7, "t").match(/<path /g) || []).length).toBe(7);
    expect(countSvg("star", 11, "t")).toBe("");
    expect(shapeSvg("blob")).toBe("");
  });
});

describe("shipped puzzles", () => {
  it("validatePuzzles accepts the shipped set; at least 6 per type; frozen", () => {
    expect(() => validatePuzzles(clone(PUZZLES))).not.toThrow();
    for (const t of TASK_TYPES) expect(puzzlesOfType(t).length, `type ${t}`).toBeGreaterThanOrEqual(6);
    expect(PUZZLES.length).toBeGreaterThanOrEqual(24);
    expect(Object.isFrozen(PUZZLES)).toBe(true);
    expect(Object.isFrozen(PUZZLES[0].choices[0])).toBe(true);
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length);
  });

  it("every puzzle has exactly 3 choices, exactly one null cell, a correctId among them and a rule", () => {
    for (const p of PUZZLES) {
      expect(p.choices, p.id).toHaveLength(3);
      expect(p.cells.filter((c) => c === null), p.id).toHaveLength(1);
      expect(p.choices.map((c) => c.id), p.id).toContain(p.correctId);
      expect(p.rule.trim().length, p.id).toBeGreaterThan(0);
      // One sentence a child could say: a single full stop, at the end.
      expect(p.rule, p.id).toMatch(/^[^.!?]+[.!?]$/);
      for (const c of [...p.cells.filter(Boolean), ...p.choices]) expect(SHAPE_KEYS, p.id).toContain(normaliseCell(c).shape);
    }
  });

  it("type 1: the correct answer genuinely continues the stated pattern; distractors are from the row and do not", () => {
    const t1 = puzzlesOfType(1);
    expect(new Set(t1.map((p) => p.pattern))).toEqual(new Set(Object.keys(PATTERNS)));
    for (const p of t1) {
      expect(p.cells.length, p.id).toBeGreaterThanOrEqual(4);
      expect(p.cells.length, p.id).toBeLessThanOrEqual(6);
      expect(p.cells[p.cells.length - 1], p.id).toBeNull();
      const row = p.cells.slice(0, -1);
      const correct = p.choices.find((c) => c.id === p.correctId);
      expect(followsUnit([...row, correct], p.pattern), p.id).toBe(true);
      for (const c of p.choices.filter((x) => x.id !== p.correctId)) {
        expect(followsUnit([...row, c], p.pattern), `${p.id} ${c.id}`).toBe(false);
        expect(row.map((r) => normaliseCell(r).shape), `${p.id} ${c.id} plausible`).toContain(normaliseCell(c).shape);
      }
    }
    // The checker itself: it says no to the wrong unit.
    expect(followsUnit(["circle", "square", "circle", "square"], "AB")).toBe(true);
    expect(followsUnit(["circle", "square", "circle", "square"], "AAB")).toBe(false);
    expect(followsUnit(["circle", "circle", "circle"], "AB")).toBe(false);
  });

  it("type 2: the odd one breaks exactly one property", () => {
    for (const p of puzzlesOfType(2)) {
      expect([4, 9], p.id).toContain(p.cells.length);
      expect(["shape", "fill", "size", "turn", "sides"], p.id).toContain(p.property);
    }
    expect(new Set(puzzlesOfType(2).map((p) => p.property)).size).toBeGreaterThanOrEqual(4);
  });

  it("type 3: every matrix states a rowRule and a colRule", () => {
    for (const p of puzzlesOfType(3)) {
      expect(p.rowRule.trim(), p.id).not.toBe("");
      expect(p.colRule.trim(), p.id).not.toBe("");
      expect([4, 9], p.id).toContain(p.cells.length);
    }
  });

  it("type 4: counts match the declared growth rule and the answer is the next count", () => {
    const next = (growth, [a, b, c]) => {
      if (growth === "plus1") return b === a + 1 && c === b + 1 ? c + 1 : null;
      if (growth === "double") return b === 2 * a && c === 2 * b ? 2 * c : null;
      if (growth === "alternate") return a !== b && c === a ? b : null;
      if (growth === "repeat") return b === a && c === a + 1 ? c : null;
      return null;
    };
    const t4 = puzzlesOfType(4);
    expect(new Set(t4.map((p) => p.growth))).toEqual(new Set(GROWTHS));
    for (const p of t4) {
      expect(p.counts, p.id).toHaveLength(4);
      expect(p.counts[3], p.id).toBeNull();
      const expected = next(p.growth, p.counts.slice(0, 3));
      expect(expected, p.id).not.toBeNull();
      expect(nextCount(p.growth, p.counts.slice(0, 3)), p.id).toBe(expected);
      expect(p.choices.find((c) => c.id === p.correctId).count, p.id).toBe(expected);
      expect(expected, p.id).toBeLessThanOrEqual(10);
    }
  });
});

describe("validatePuzzles rejects", () => {
  it("a correctId that is not among the choices", () => {
    rejects((l) => { byId(l, "pp-t1-01").correctId = "z"; }, 'pp-t1-01: correctId "z" is not among the choices (a, b, c)');
  });
  it("2 or 4 choices", () => {
    rejects((l) => { byId(l, "pp-t2-01").choices.pop(); }, "pp-t2-01: needs exactly 3 choices, has 2");
    rejects((l) => { byId(l, "pp-t2-01").choices.push({ id: "d", shape: "moon" }); }, "pp-t2-01: needs exactly 3 choices, has 4");
  });
  it("an unknown shape key, in a cell or a choice", () => {
    rejects((l) => { byId(l, "pp-t3-01").cells[0] = { shape: "blob" }; }, 'pp-t3-01: cells[0] uses unknown shape "blob"');
    rejects((l) => { byId(l, "pp-t4-01").choices[0].shape = "blob"; }, 'pp-t4-01: choice a uses unknown shape "blob"');
  });
  it("an empty rule", () => {
    rejects((l) => { byId(l, "pp-t1-02").rule = "   "; }, "pp-t1-02: rule is empty");
    rejects((l) => { delete byId(l, "pp-t1-02").rule; }, "pp-t1-02: rule is empty");
  });
  it("a type 3 puzzle missing rowRule or colRule", () => {
    rejects((l) => { delete byId(l, "pp-t3-02").rowRule; }, "pp-t3-02: type 3 needs a rowRule");
    rejects((l) => { byId(l, "pp-t3-02").colRule = ""; }, "pp-t3-02: type 3 needs a colRule");
  });
  it("a type 4 puzzle whose counts do not grow by its rule", () => {
    rejects((l) => { byId(l, "pp-t4-01").counts = [1, 2, 4, null]; }, 'pp-t4-01: counts 1, 2, 4 do not grow by "plus1"');
    rejects((l) => { byId(l, "pp-t4-03").counts = [1, 2, 3, null]; }, 'pp-t4-03: counts 1, 2, 3 do not grow by "double"');
    rejects((l) => { byId(l, "pp-t4-04").counts = [2, 5, 3, null]; }, 'pp-t4-04: counts 2, 5, 3 do not grow by "alternate"');
    rejects((l) => { byId(l, "pp-t4-05").counts = [2, 3, 3, null]; }, 'pp-t4-05: counts 2, 3, 3 do not grow by "repeat"');
    rejects((l) => { byId(l, "pp-t4-01").growth = "triple"; }, 'pp-t4-01: unknown growth "triple"');
  });
  it("two null cells", () => {
    rejects((l) => { byId(l, "pp-t2-05").cells[0] = null; }, "pp-t2-05: has 2 null cells; exactly one cell may be missing");
  });
  it("content mistakes the brief warns about", () => {
    // Type 1: an answer that breaks the pattern.
    rejects((l) => { byId(l, "pp-t1-07").correctId = "a"; }, "pp-t1-07: the answer does not continue ABC");
    // Type 1: a random shape is noise, not a distractor.
    rejects((l) => { byId(l, "pp-t1-07").choices[0].shape = "moon"; }, "pp-t1-07: distractor a (moon) is not in the row");
    // Type 2: an odd one that breaks two properties.
    rejects((l) => { byId(l, "pp-t2-03").choices[0].shape = "triangle"; byId(l, "pp-t2-03").choices[0].fill = "dots"; },
      'pp-t2-03: the answer breaks two properties ("size" and "fill")');
    // Type 3: a distractor that also fits.
    rejects((l) => { Object.assign(byId(l, "pp-t3-01").choices[0], { shape: "square", fill: "stripes" }); }, "pp-t3-01: two choices look the same");
    // A turn nobody can see.
    rejects((l) => { byId(l, "pp-t2-01").cells[0] = { shape: "circle", turn: 90 }; }, "pp-t2-01: cells[0] turns a circle");
    // No gap at all.
    rejects((l) => { byId(l, "pp-t3-06").cells[6] = "star"; }, "pp-t3-06: has no null cell");
  });
});

describe("unlocking", () => {
  it("4 of the last 5 unlocks; 3 of the last 5 does not; a wrong answer never locks", () => {
    expect(shouldUnlock([true, true, false, true, true])).toBe(true);
    expect(shouldUnlock([true, false, true, false, true])).toBe(false);
    expect(shouldUnlock([true, true, true])).toBe(false);
    expect(shouldUnlock([false, false, false, true, true, false, true, true])).toBe(true);
    expect(unlockedFromCompleted([])).toBe(1);
    expect(unlockedFromCompleted(["type-1", "type-2"])).toBe(3);
    expect(unlockedFromCompleted(["type-3"])).toBe(1);
    expect(unlockedFromCompleted(["type-1", "type-2", "type-3", "type-4"])).toBe(4);
  });

  it("in play: 4 right of the last 5 opens type 2; 3 of 5 keeps type 1; wrong answers never close anything", () => {
    let s = initialState({ seed: 3 });
    expect(s.type).toBe(1);
    for (const right of [true, false, true, false, true]) s = answer(s, right);
    expect(s.unlocked).toBe(1);
    s = answer(s, true); // last five: F T F T T -> 3 of 5
    expect(s.unlocked).toBe(1);

    let u = initialState({ seed: 4 });
    for (const right of [true, true, false, true, true]) u = answer(u, right);
    expect(u.unlocked).toBe(2);
    expect(u.completedTypes).toEqual([1]);
    u = answer(u, false); // a wrong answer after unlocking closes nothing
    expect(u.unlocked).toBe(2);
    expect(u.phase).toBe("done");
    u = reduce(u, { type: "AGAIN", seed: 9 });
    expect(u.type).toBe(2); // auto: the next session is the new type
  });

  it("the grown-up's task dial picks a type; the rule dial is on by default", () => {
    expect(DEFAULT_DIALS).toEqual({ task: "auto", rule: "on" });
    let s = initialState({ seed: 1 });
    s = reduce(s, { type: "DIALS", dials: { task: 4, rule: "on" }, seed: 2 });
    expect(s.type).toBe(4);
    expect(s.current.type).toBe(4);
    const before = s.queue;
    s = reduce(s, { type: "DIALS", dials: { task: 4, rule: "off" }, seed: 3 });
    expect(s.queue).toBe(before); // rule dial keeps the puzzle
    expect(reduce(s, { type: "DIALS", dials: { task: 4, rule: "off" }, seed: 4 })).toBe(s);
  });
});

describe("sessions and the reveal", () => {
  it("a session is 6 distinct puzzles of one type, deterministic per seed", () => {
    for (const t of TASK_TYPES) {
      const q = buildSession(t, 42);
      expect(q).toHaveLength(SESSION_LENGTH);
      expect(new Set(q.map((p) => p.id)).size).toBe(SESSION_LENGTH);
      expect(q.every((p) => p.type === t)).toBe(true);
      expect(buildSession(t, 42).map((p) => p.id)).toEqual(q.map((p) => p.id));
    }
  });

  it("a wrong pick fills the gap with the answer, shows the rule, and moves on; no score in the view", () => {
    let s = initialState({ seed: 5 });
    const v0 = itemView(s);
    expect(v0.cells.filter((c) => c.missing && c.look === null)).toHaveLength(1);
    expect(v0.showRule).toBe(false);
    s = reduce(s, { type: "PICK", id: wrongId(s) });
    expect(s.result).toBe("shown");
    expect(s.attempts).toBe(1);
    const v = itemView(s);
    const gap = v.cells.find((c) => c.missing);
    expect(gap.answer).toBe(true);
    expect(gap.look).not.toBeNull();
    expect(v.choices.filter((c) => c.correct)).toHaveLength(1);
    expect(v.showRule).toBe(true);
    expect(v.rule.text).toBe(s.current.rule);
    expect(v.rule.key).toBe(`patternPuzzles.rule.${s.current.id}`);
    expect(JSON.stringify(v)).not.toMatch(/score|streak|timer|seconds/i);
    expect(reduce(s, { type: "PICK", id: s.current.correctId })).toBe(s); // one answer per puzzle
    s = reduce(s, { type: "NEXT" });
    expect(s.index).toBe(1);
    expect(s.phase).toBe("ask");
  });

  it("a right pick also shows the rule; turning the rule dial off hides it", () => {
    let s = initialState({ seed: 6 });
    s = reduce(s, { type: "PICK", id: s.current.correctId });
    expect(itemView(s).showRule).toBe(true);
    const off = initialState({ seed: 6, dials: { task: "auto", rule: "off" } });
    expect(itemView(reduce(off, { type: "PICK", id: off.current.correctId })).showRule).toBe(false);
  });

  it("type 3 views carry both axis rules; type 4 cells carry their counts", () => {
    const m = initialState({ seed: 7, dials: { task: 3, rule: "on" } });
    expect(itemView(m).axisRules).toHaveLength(2);
    const g = initialState({ seed: 7, dials: { task: 4, rule: "on" } });
    const v = itemView(g);
    expect(v.rows).toBe(1);
    expect(v.cells.slice(0, 3).map((c) => c.look.count)).toEqual(g.current.counts.slice(0, 3));
  });

  it("after 6 puzzles: done, with again", () => {
    let s = initialState({ seed: 8 });
    for (let i = 0; i < 6; i++) s = answer(s, i % 2 === 0);
    expect(s.phase).toBe("done");
    s = reduce(s, { type: "AGAIN", seed: 10 });
    expect(s.phase).toBe("ask");
    expect(s.index).toBe(0);
  });
});

describe("progress", () => {
  it("the payload says app_id 'pattern-puzzles' literally, lesson = task type, step = puzzle index", () => {
    expect(APP_ID).toBe("pattern-puzzles");
    let s = initialState({ seed: 11 });
    s = reduce(s, { type: "PICK", id: s.current.correctId });
    const body = progressPayload({ childId: "child-x", ...s.answer, seconds: 12 });
    expect(body.app_id).toBe("pattern-puzzles");
    expect(body.app_id).not.toBe("act1-sensory-learning");
    expect(body.lesson_id).toBe(lessonId(1));
    expect(body.lesson_id).toBe("type-1");
    expect(body.step_index).toBe(s.current.poolIndex);
    expect(body).toEqual({ child_id: "child-x", app_id: "pattern-puzzles", lesson_id: "type-1", step_index: s.current.poolIndex, completed: false, seconds: 12 });
    expect(progressPayload({ childId: "c", lessonId: "type-2", step: 3, seconds: 9999 }).seconds).toBe(600);
  });
});
