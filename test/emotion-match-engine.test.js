import { describe, it, expect } from "vitest";
import {
  EMOTIONS, INTENSITIES, FACE_SVG, SCENE_SVG, faceKey, hasFace, parseFaceKey,
} from "../public/apps/emotion-match/engine/faces.js";
import {
  ITEMS, NEAR, TASK_TYPES, MIN_CHOICES, MAX_CHOICES,
  validateItems, validateItem, intensityItem, itemsOfType,
} from "../public/apps/emotion-match/engine/items.js";
import {
  APP_ID, SESSION_LENGTH, DEFAULT_DIALS,
  shouldUnlock, unlockedFromCompleted, buildSession, initialState, reduce,
  progressPayload, itemView, lessonId,
} from "../public/apps/emotion-match/engine/game.js";

// Emotion Matcher engine: content, validator and game rules, played in Node.

const clone = (x) => JSON.parse(JSON.stringify(x));
const item = (id) => clone(ITEMS.find((i) => i.id === id));
const wrongId = (s) => s.current.choices.find((c) => c.id !== s.current.correctId).id;
const answer = (s, right) => reduce(reduce(s, { type: "PICK", id: right ? s.current.correctId : wrongId(s) }), { type: "NEXT" });

describe("faces", () => {
  it("8 emotions x 3 intensities, every key present, frozen", () => {
    expect(EMOTIONS).toEqual(["happy", "sad", "angry", "scared", "surprised", "tired", "calm", "proud"]);
    expect(INTENSITIES).toEqual(["little", "quite", "very"]);
    expect(Object.keys(FACE_SVG)).toHaveLength(24);
    for (const e of EMOTIONS) for (const i of INTENSITIES) expect(hasFace(faceKey(e, i)), `${e}-${i}`).toBe(true);
    expect(Object.isFrozen(FACE_SVG)).toBe(true);
    expect(parseFaceKey("angry-very")).toEqual({ emotion: "angry", intensity: "very" });
    expect(parseFaceKey("angry-extreme")).toBeNull();
  });

  it("pictures are inert, aria-hidden, currentColor 2-unit ink, and the three intensities of an emotion differ in drawing", () => {
    for (const [key, svg] of Object.entries({ ...FACE_SVG, ...SCENE_SVG })) {
      expect(svg, key).toMatch(/^<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">/);
      expect(svg, key).not.toMatch(/<script|<image|<text|href|http|\son[a-z]+=/i);
      // Only currentColor: no colour carries meaning.
      expect(svg.match(/(?:fill|stroke)="([^"]+)"/g).every((a) => /"(currentColor|none)"/.test(a)), key).toBe(true);
      expect([...svg.matchAll(/stroke-width="([^"]+)"/g)].every((m) => m[1] === "2"), key).toBe(true);
    }
    for (const e of EMOTIONS) {
      const drawn = INTENSITIES.map((i) => FACE_SVG[faceKey(e, i)]);
      expect(new Set(drawn).size, e).toBe(3);
    }
    // Scenes never contain a face outline, so the picture cannot answer.
    for (const [key, svg] of Object.entries(SCENE_SVG)) expect(svg, key).not.toContain('r="40"');
  });
});

describe("shipped items", () => {
  it("validateItems accepts the shipped set; at least 8 per type, frozen", () => {
    expect(() => validateItems(clone(ITEMS))).not.toThrow();
    for (const type of TASK_TYPES) expect(itemsOfType(type).length, `type ${type}`).toBeGreaterThanOrEqual(8);
    expect(ITEMS.length).toBeGreaterThanOrEqual(24);
    expect(Object.isFrozen(ITEMS)).toBe(true);
    expect(Object.isFrozen(ITEMS[0].choices[0])).toBe(true);
  });

  it("every item has 3-4 choices, prompt, audio, and a correctId among them", () => {
    for (const it_ of ITEMS) {
      expect(it_.choices.length, it_.id).toBeGreaterThanOrEqual(MIN_CHOICES);
      expect(it_.choices.length, it_.id).toBeLessThanOrEqual(MAX_CHOICES);
      expect(typeof it_.prompt).toBe("string");
      expect(typeof it_.audio).toBe("string");
      expect(it_.choices.map((c) => c.id)).toContain(it_.correctId);
    }
  });

  it("type 1 answers are single words; type 2 distractors are near-misses (never happy for angry)", () => {
    for (const it_ of itemsOfType(1)) expect(it_.correctId, it_.id).toMatch(/^[a-z]+$/);
    for (const it_ of itemsOfType(2)) {
      for (const c of it_.choices) if (c.id !== it_.correctId) expect(NEAR[it_.correctId], it_.id).toContain(c.id);
    }
    const angry = itemsOfType(2).find((i) => i.correctId === "angry");
    expect(angry.choices.map((c) => c.id)).not.toContain("happy");
  });

  it("type 3 items have a scenario and an empty alternatives list", () => {
    for (const it_ of itemsOfType(3)) {
      expect(it_.scenario, it_.id).toMatch(/^emotionMatch\.scenario\./);
      expect(it_.alternatives, it_.id).toEqual([]);
    }
  });

  it("intensity items reference faces that exist for all three intensities of the emotion", () => {
    for (const base of ITEMS) {
      for (const target of INTENSITIES) {
        const x = intensityItem(base, target);
        expect(x.choices.map((c) => c.face).sort()).toEqual(INTENSITIES.map((i) => faceKey(base.correctId, i)).sort());
        for (const c of x.choices) expect(hasFace(c.face), c.face).toBe(true);
        expect(x.correctId).toBe(faceKey(base.correctId, target));
        expect(new Set(x.choices.map((c) => c.id)).size).toBe(3);
      }
    }
  });
});

describe("validateItems rejects", () => {
  const expectThrow = (mutate, pattern, id = "t2-angry") => {
    const items = clone(ITEMS);
    mutate(items.find((i) => i.id === id));
    expect(() => validateItems(items)).toThrow(pattern);
  };

  it("a correctId missing from the choices", () => {
    expectThrow((i) => { i.correctId = "happy"; }, /correctId happy is not one of the choices/);
  });
  it("a duplicate choice", () => {
    expectThrow((i) => { i.choices[1] = clone(i.choices[0]); }, /duplicate choice id/);
  });
  it("an unknown face key", () => {
    expectThrow((i) => { i.choices[0].face = "angry-extreme"; }, /unknown face key angry-extreme/);
    expectThrow((i) => { i.face = "grumpy-quite"; }, /unknown face key grumpy-quite/, "t1-happy");
  });
  it("a type 3 item with a non-empty alternatives list", () => {
    expectThrow((i) => { i.alternatives = ["sad"]; }, /second defensible answer \(sad\)/, "t3-tower");
  });
  it("a missing prompt (the clue) or audio field", () => {
    expectThrow((i) => { delete i.prompt; }, /prompt must be/);
    expectThrow((i) => { delete i.audio; }, /audio must be/);
    expectThrow((i) => { delete i.scenario; }, /scenario must be/, "t3-dog");
    expectThrow((i) => { delete i.correctId; }, /correctId is required/);
  });
  it("a far distractor on a type 2 item, too few items, or too many choices", () => {
    expectThrow((i) => { i.choices[0] = { id: "happy", face: "happy-quite" }; }, /not a near-miss/);
    expect(() => validateItems(clone(ITEMS).filter((i) => i.id !== "t3-dog" && i.id !== "t3-snack" && i.id !== "t3-garden"))).toThrow(/type 3 has 7 items/);
    const five = item("t1-happy");
    five.choices.push({ id: "tired", face: "tired-quite" }, { id: "calm", face: "calm-quite" });
    expect(() => validateItem(five)).toThrow(/choices must number 3-4/);
  });
});

describe("unlocking", () => {
  it("4 of the last 5 advances; 3 of the last 5 does not", () => {
    expect(shouldUnlock([true, true, false, true, true])).toBe(true);
    expect(shouldUnlock([false, true, true, true, true])).toBe(true);
    expect(shouldUnlock([true, false, true, false, true])).toBe(false);
    // Only the last five count.
    expect(shouldUnlock([true, true, true, true, false, false, true, true, false])).toBe(false);
  });

  it("in play: 4 right of 5 opens type 2 and marks type-1 complete; 3 of 5 does not", () => {
    let s = initialState({ seed: 3 });
    expect(s.type).toBe(1);
    expect(s.unlocked).toBe(1);
    for (const r of [true, false, true, false, true]) s = answer(s, r);
    expect(s.unlocked).toBe(1);
    expect(s.completedTypes).toEqual([]);

    let u = initialState({ seed: 3 });
    for (const r of [true, true, false, true]) u = answer(u, r);
    expect(u.unlocked).toBe(1);
    u = reduce(u, { type: "PICK", id: u.current.correctId });
    expect(u.unlocked).toBe(2);
    expect(u.answer).toMatchObject({ lessonId: "type-1", completed: true, newlyCompleted: true });
    // The session keeps its kind; the next one in auto is type 2.
    expect(u.type).toBe(1);
  });

  it("a wrong answer never locks anything", () => {
    let s = initialState({ completed: ["type-1"], seed: 9 });
    expect(s.unlocked).toBe(2);
    expect(s.type).toBe(2);
    for (let i = 0; i < SESSION_LENGTH; i++) {
      s = answer(s, false);
      expect(s.unlocked).toBe(2);
    }
    expect(s.phase).toBe("done");
    expect(unlockedFromCompleted(["type-1", "type-2"])).toBe(3);
    // The chain is sequential: type-2 alone opens nothing.
    expect(unlockedFromCompleted(["type-2"])).toBe(1);
  });

  it("a wrong pick reveals the right face and moves on; attempts are counted, never a score", () => {
    let s = initialState({ seed: 5 });
    const right = s.current.correctId;
    s = reduce(s, { type: "PICK", id: wrongId(s) });
    expect(s.phase).toBe("revealed");
    expect(s.result).toBe("shown");
    const v = itemView(s);
    expect(v.correctId).toBe(right);
    expect(v.choices.filter((c) => c.correct).map((c) => c.id)).toEqual([right]);
    // Picking again after the reveal does nothing.
    expect(reduce(s, { type: "PICK", id: right })).toBe(s);
    expect(s.attempts).toBe(1);
    s = reduce(s, { type: "NEXT" });
    expect(s.index).toBe(1);
    expect(s.phase).toBe("ask");
    expect(JSON.stringify(progressPayload({ childId: "c", ...s.answer }))).not.toContain("score");
  });
});

describe("sessions and the intensity layer", () => {
  it("a session is 8 distinct items of one type, then done; again starts a new one", () => {
    for (const type of TASK_TYPES) {
      const q = buildSession(type, 42);
      expect(q).toHaveLength(SESSION_LENGTH);
      expect(new Set(q.map((i) => i.id)).size).toBe(SESSION_LENGTH);
      expect(q.every((i) => i.type === type)).toBe(true);
    }
    expect(buildSession(3, 42).map((i) => i.id)).toEqual(buildSession(3, 42).map((i) => i.id));
    let s = initialState({ seed: 11 });
    for (let i = 0; i < SESSION_LENGTH; i++) s = answer(s, true);
    expect(s.phase).toBe("done");
    expect(itemView(s).nextTimeNew).toBe(true);
    s = reduce(s, { type: "AGAIN", seed: 12 });
    expect(s.phase).toBe("ask");
    expect(s.type).toBe(2);
    expect(s.index).toBe(0);
  });

  it("a grown-up lock plays that type; auto is the default", () => {
    expect(DEFAULT_DIALS).toEqual({ task: "auto", intensity: "off" });
    expect(initialState({ dials: { task: 3, intensity: "off" }, seed: 1 }).type).toBe(3);
    const s = reduce(initialState({ seed: 1 }), { type: "DIALS", dials: { task: 2, intensity: "off" }, seed: 2 });
    expect(s.type).toBe(2);
    expect(s.unlocked).toBe(1);
  });

  it("intensity on: a right base answer returns as three intensities of the same emotion", () => {
    let s = initialState({ dials: { task: 2, intensity: "on" }, seed: 21 });
    const emotion = s.current.correctId;
    s = reduce(reduce(s, { type: "PICK", id: emotion }), { type: "NEXT" });
    expect(s.layer).toBe("intensity");
    expect(s.index).toBe(0);
    const v = itemView(s);
    expect(v.choices.map((c) => c.emotion)).toEqual([emotion, emotion, emotion]);
    expect(v.choices.map((c) => c.intensity).sort()).toEqual([...INTENSITIES].sort());
    expect(v.prompt).toBe("emotionMatch.prompt_intensity");
    expect(INTENSITIES).toContain(v.amount);
    // Intensity answers are not base answers: no progress post, no unlock count.
    const before = s.history[2].length;
    s = reduce(s, { type: "PICK", id: s.current.correctId });
    expect(s.answer).toBeNull();
    expect(s.history[2]).toHaveLength(before);
    s = reduce(s, { type: "NEXT" });
    expect(s.layer).toBe("base");
    expect(s.index).toBe(1);
  });

  it("intensity on: a wrong base answer does not get an intensity question; off never does", () => {
    let s = initialState({ dials: { task: 1, intensity: "on" }, seed: 4 });
    s = answer(s, false);
    expect(s.layer).toBe("base");
    let off = initialState({ seed: 4 });
    off = answer(off, true);
    expect(off.layer).toBe("base");
  });

  it("before the reveal the view carries no answer", () => {
    const v = itemView(initialState({ dials: { task: 2, intensity: "off" }, seed: 8 }));
    expect(v.correctId).toBeNull();
    expect(v.choices.every((c) => c.revealed === false && c.correct === false)).toBe(true);
  });
});

describe("progress payload", () => {
  it("app_id is literally 'emotion-match', lesson_id is the task type", () => {
    expect(APP_ID).toBe("emotion-match");
    const p = progressPayload({ childId: "child-1", lessonId: lessonId(2), step: 4, completed: false, seconds: 12.4 });
    expect(p).toEqual({ child_id: "child-1", app_id: "emotion-match", lesson_id: "type-2", step_index: 4, completed: false, seconds: 12 });
    expect(p.app_id).not.toBe("act1-sensory-learning");
    expect(progressPayload({ childId: "c", lessonId: "type-1", step: 2, seconds: 9999 }).seconds).toBe(600);

    let s = initialState({ seed: 2 });
    const step = s.current.poolIndex;
    s = reduce(s, { type: "PICK", id: s.current.correctId });
    expect(progressPayload({ childId: "c", ...s.answer })).toMatchObject({ app_id: "emotion-match", lesson_id: "type-1", step_index: step });
  });
});
