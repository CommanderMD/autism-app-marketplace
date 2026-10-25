import { describe, it, expect } from "vitest";
import { colouredSteps } from "../public/apps/act1/lessons/01-shapes.js";
import { LESSON_ORDER } from "../src/routes/progress.js";
import {
  LESSON_SHAPE, MODES, CANONICAL_ORDER, validateLesson, validateCurriculum, renderStep,
} from "../public/apps/act1/engine/lesson.js";
import { SVG, PALETTE, svgFor } from "../public/apps/act1/engine/svg.js";
import { LESSONS } from "../public/apps/act1/engine/curriculum.js";
import { initialState, reduce, currentStep, unlockedIds } from "../public/apps/act1/engine/state.js";
import { planReward, flashRate, violatesFlashBudget } from "../public/apps/act1/engine/reward.js";
import shapes from "../public/apps/act1/lessons/01-shapes.js";
import numbers from "../public/apps/act1/lessons/02-numbers.js";
import nouns from "../public/apps/act1/lessons/03-nouns.js";
import verbs from "../public/apps/act1/lessons/04-verbs.js";
import colors from "../public/apps/act1/lessons/05-colors.js";
import emotions from "../public/apps/act1/lessons/06-emotions.js";
import opposites from "../public/apps/act1/lessons/07-opposites.js";
import sequencing from "../public/apps/act1/lessons/08-sequencing.js";
import prepositions from "../public/apps/act1/lessons/09-prepositions.js";
import math from "../public/apps/act1/lessons/10-math.js";
// Sources as text, for the purity scan.
import lessonSrc from "../public/apps/act1/engine/lesson.js?raw";
import stateSrc from "../public/apps/act1/engine/state.js?raw";
import rewardSrc from "../public/apps/act1/engine/reward.js?raw";
import svgSrc from "../public/apps/act1/engine/svg.js?raw";
import curriculumSrc from "../public/apps/act1/engine/curriculum.js?raw";
import l01 from "../public/apps/act1/lessons/01-shapes.js?raw";
import l02 from "../public/apps/act1/lessons/02-numbers.js?raw";
import l03 from "../public/apps/act1/lessons/03-nouns.js?raw";
import l04 from "../public/apps/act1/lessons/04-verbs.js?raw";
import l05 from "../public/apps/act1/lessons/05-colors.js?raw";
import l06 from "../public/apps/act1/lessons/06-emotions.js?raw";
import l07 from "../public/apps/act1/lessons/07-opposites.js?raw";
import l08 from "../public/apps/act1/lessons/08-sequencing.js?raw";
import l09 from "../public/apps/act1/lessons/09-prepositions.js?raw";
import l10 from "../public/apps/act1/lessons/10-math.js?raw";

// Phase 4 part B: engine, lessons, SVG library and reward planner. Pure
// modules, imported straight from public/ - no DOM, no jsdom.

const BY_FILE = {
  "01-shapes": shapes, "02-numbers": numbers, "03-nouns": nouns, "04-verbs": verbs, "05-colors": colors,
  "06-emotions": emotions, "07-opposites": opposites, "08-sequencing": sequencing,
  "09-prepositions": prepositions, "10-math": math,
};
const ALL = Object.values(BY_FILE);

const SOURCES = {
  "engine/lesson.js": lessonSrc, "engine/state.js": stateSrc, "engine/reward.js": rewardSrc,
  "engine/svg.js": svgSrc, "engine/curriculum.js": curriculumSrc,
  "lessons/01-shapes.js": l01, "lessons/02-numbers.js": l02, "lessons/03-nouns.js": l03,
  "lessons/04-verbs.js": l04, "lessons/05-colors.js": l05, "lessons/06-emotions.js": l06,
  "lessons/07-opposites.js": l07, "lessons/08-sequencing.js": l08, "lessons/09-prepositions.js": l09,
  "lessons/10-math.js": l10,
};

const correctId = (step) => step.choices.find((c) => c.correct === true)?.id ?? null;
function rightAnswer(step) {
  if (step.mode === "drag") return { count: step.target.count };
  if (step.mode === "sequence") return [...step.answer];
  return correctId(step);
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const SETTINGS = { volume: 60, flash_intensity: 50, animation_speed: 1, contrast: "normal", animations: true, safe_mode: true };

describe("0. purity: no browser APIs, clock or randomness in engine/ and lessons/", () => {
  const BANNED = [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bAudio\b/, /\bAudioContext\b/,
    /\bspeechSynthesis\b/, /Date\.now/, /new Date\b/, /Math\.random/, /\bsetTimeout\b/, /\bsetInterval\b/,
    /\brequestAnimationFrame\b/, /\brequire\(/, /\bfetch\(/];
  for (const [file, src] of Object.entries(SOURCES)) {
    it(file, () => {
      // Comments may name the banned APIs to say they are banned; code may not.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
      for (const re of BANNED) expect(code, `${file} uses ${re}`).not.toMatch(re);
      // Relative imports only: no bare specifiers, no absolute paths.
      for (const m of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(m[1], file).toMatch(/^\.\.?\//);
    });
  }
});

describe("1. contract", () => {
  it("validateCurriculum passes and returns the canonical order", () => {
    const ordered = validateCurriculum(ALL);
    expect(ordered.map((l) => l.id)).toEqual([...CANONICAL_ORDER]);
    expect(LESSONS.map((l) => l.id)).toEqual([...CANONICAL_ORDER]);
  });

  it("the engine's canonical order is the server's unlock order", () => {
    expect([...CANONICAL_ORDER]).toEqual(LESSON_ORDER);
  });

  it("every lesson id matches its file name and has the six contract keys", () => {
    for (const [file, lesson] of Object.entries(BY_FILE)) {
      expect(lesson.id).toBe(file);
      expect(Object.keys(lesson).sort()).toEqual([...LESSON_SHAPE].sort());
    }
  });

  it("order is 1-10, no duplicates, no gaps; every lesson has >= 8 steps", () => {
    expect(ALL.map((l) => l.order).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of ALL) expect(l.steps.length, l.id).toBeGreaterThanOrEqual(8);
  });

  it("a derived order that differs from the canonical list throws, it is not sorted into shape", () => {
    const swapped = ALL.map((l) => (l.id === "03-nouns" ? { ...l, order: 4 } : l.id === "04-verbs" ? { ...l, order: 3 } : l));
    expect(() => validateCurriculum(swapped)).toThrow(/prefix does not match order/);
    expect(() => validateCurriculum(ALL.slice(1))).toThrow(/not the canonical order/);
    expect(() => validateCurriculum([...ALL, shapes])).toThrow(/duplicate lesson id "01-shapes"/);
  });

  it("validateLesson names the lesson and the violation", () => {
    const step = shapes.steps[0];
    const bad = (patch) => ({ ...shapes, ...patch });
    expect(() => validateLesson(bad({ steps: shapes.steps.slice(0, 7) }))).toThrow(/"01-shapes".*7 steps/);
    expect(() => validateLesson({ ...shapes, render: undefined })).toThrow(/render must be a function/);
    const { check, ...noCheck } = shapes;
    expect(() => validateLesson(noCheck)).toThrow(/missing key "check"/);
    expect(() => validateLesson(bad({ order: 11 }))).toThrow(/order must be an integer 1-10/);
    const withStep = (s) => bad({ steps: [s, ...shapes.steps.slice(1)] });
    expect(() => validateLesson(withStep({ ...step, choices: step.choices.slice(0, 1) }))).toThrow(/1 choices; must be 2-4/);
    expect(() => validateLesson(withStep({ ...step, choices: [...step.choices, { id: "a", label: "a", svg: "star" }, { id: "b", label: "b", svg: "star" }] }))).toThrow(/5 choices/);
    expect(() => validateLesson(withStep({ ...step, choices: step.choices.map((c) => ({ ...c, correct: true })) }))).toThrow(/exactly one correct choice, has 3/);
    expect(() => validateLesson(withStep({ ...step, audio: "" }))).toThrow(/no audio string/);
    expect(() => validateLesson(withStep({ ...step, mode: "swipe" }))).toThrow(/mode must be one of/);
    expect(() => validateLesson(withStep({ ...step, choices: step.choices.map((c, i) => (i ? c : { ...c, svg: "nope" })) }))).toThrow(/unknown svg key "nope"/);
    expect(() => validateLesson(withStep({ ...step, id: shapes.steps[1].id }))).toThrow(/duplicate step id/);
  });
});

describe("2. step shape", () => {
  for (const lesson of ALL) {
    it(lesson.id, () => {
      const ids = new Set();
      for (const step of lesson.steps) {
        expect(ids.has(step.id), step.id).toBe(false);
        ids.add(step.id);
        expect(MODES).toContain(step.mode);
        expect(step.prompt.trim().length, step.id).toBeGreaterThan(0);
        expect(step.audio.trim().length, step.id).toBeGreaterThan(0);
        // Audio is plain words for TTS: no symbols, no emoji.
        expect(step.audio, step.id).toMatch(/^[A-Za-z0-9 .,']+$/);
        expect(step.choices.length, step.id).toBeGreaterThanOrEqual(2);
        expect(step.choices.length, step.id).toBeLessThanOrEqual(4);
        for (const c of step.choices) {
          expect(typeof c.id).toBe("string");
          expect(typeof c.label).toBe("string");
          expect(typeof c.svg).toBe("string");
        }
        const flagged = step.choices.filter((c) => c.correct === true).length;
        if (step.mode === "sequence") {
          expect(flagged).toBe(0);
          expect([...step.answer].sort()).toEqual(step.choices.map((c) => c.id).sort());
          // The authored order is never already the answer.
          expect(step.choices.map((c) => c.id), step.id).not.toEqual(step.answer);
        } else if (step.mode === "drag") {
          expect(flagged).toBe(0);
          expect(Number.isInteger(step.target.count)).toBe(true);
        } else {
          expect(flagged, step.id).toBe(1);
        }
      }
    });
  }

  it("mode mix: drag in 02 and 10, sequence throughout 08, tap everywhere else", () => {
    expect(numbers.steps.some((s) => s.mode === "drag")).toBe(true);
    expect(math.steps.some((s) => s.mode === "drag")).toBe(true);
    expect(sequencing.steps.every((s) => s.mode === "sequence")).toBe(true);
    for (const l of [shapes, nouns, verbs, colors, emotions, opposites, prepositions]) {
      expect(l.steps.every((s) => s.mode === "tap"), l.id).toBe(true);
    }
  });

  it("render returns a descriptor that never carries the answer", () => {
    for (const lesson of ALL) {
      lesson.steps.forEach((step, index) => {
        const total = lesson.steps.length;
        const d = lesson.render(step, { index, total, settings: SETTINGS, isFirst: index === 0, isLast: index === total - 1 });
        expect(Object.keys(d).sort()).toEqual(["audio", "choices", "mode", "progress", "prompt", "target"]);
        expect(d.progress).toEqual({ index, total });
        for (const c of d.choices) expect(Object.keys(c).sort()).toEqual(["id", "label", "svg"]);
        expect(JSON.stringify(d)).not.toContain("correct");
        expect(d.choices.map((c) => c.id)).toEqual(step.choices.map((c) => c.id));
      });
    }
    expect(renderStep).toBe(shapes.render);
  });

  it("lessons are frozen", () => {
    for (const l of ALL) {
      expect(Object.isFrozen(l)).toBe(true);
      expect(Object.isFrozen(l.steps[0].choices[0])).toBe(true);
    }
  });
});

describe("3/4. SVG library", () => {
  it("every svg key and drag zone referenced by any lesson exists", () => {
    for (const l of ALL) {
      for (const s of l.steps) {
        for (const c of s.choices) expect(Object.hasOwn(SVG, c.svg), `${s.id} ${c.svg}`).toBe(true);
        if (s.target) expect(Object.hasOwn(SVG, s.target.zone), s.id).toBe(true);
      }
    }
  });

  it("no entry contains http, <script, <image or onload, and every entry is a self-contained 100x100 svg", () => {
    expect(Object.isFrozen(SVG)).toBe(true);
    for (const [k, markup] of Object.entries(SVG)) {
      const lower = markup.toLowerCase();
      for (const bad of ["http", "<script", "<image", "onload", "href", "<foreignobject", "javascript:"]) {
        expect(lower, `${k} contains ${bad}`).not.toContain(bad);
      }
      expect(markup.startsWith('<svg viewBox="0 0 100 100" role="img" aria-hidden="true"'), k).toBe(true);
      expect(markup.endsWith("</svg>"), k).toBe(true);
      expect((markup.match(/<svg/g) || []).length, k).toBe(1);
    }
  });

  it("numbers 1-10 and counters 1-10 exist; svgFor never throws", () => {
    for (let n = 1; n <= 10; n++) {
      expect(svgFor(`num-${n}`)).toContain(`>${n}<`);
      expect((svgFor(`dots-${n}`).match(/<circle/g) || []).length).toBe(n);
    }
    expect(svgFor("nope")).toBeNull();
    expect(svgFor(undefined)).toBeNull();
    expect(svgFor("toString")).toBeNull();
  });

  it("colour swatch contrast: >= 4.5:1 on white alone, or labelled and outlined (yellow)", () => {
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const report = {};
    for (const [name, hex] of Object.entries(PALETTE)) {
      const vsWhite = ratio(hex, "#ffffff");
      const vsInk = ratio(hex, "#14181f");
      report[name] = `${hex} ${vsWhite.toFixed(2)}:1 on white, outline ${vsInk.toFixed(2)}:1`;
      if (name === "yellow") {
        expect(vsWhite).toBeLessThan(4.5);
        expect(vsInk).toBeGreaterThanOrEqual(4.5);
      } else {
        expect(vsWhite, name).toBeGreaterThanOrEqual(4.5);
      }
      expect(SVG[`color-${name}`]).toContain('stroke="#14181f"');
    }
    console.log("swatch contrast", report);
    for (const s of colors.steps) for (const c of s.choices) expect(c.label).toBe(c.svg.replace("color-", ""));
  });
});

describe("5. check() correctness, all ten lessons", () => {
  for (const lesson of ALL) {
    it(lesson.id, () => {
      for (const step of lesson.steps) {
        expect(lesson.check(rightAnswer(step), step), step.id).toEqual({ correct: true, highlight: null });
        if (step.mode === "tap") {
          for (const c of step.choices.filter((x) => !x.correct)) {
            expect(lesson.check(c.id, step), `${step.id} ${c.id}`).toEqual({ correct: false, highlight: correctId(step) });
          }
        } else if (step.mode === "drag") {
          for (let n = 0; n <= step.choices.length; n++) {
            if (n === step.target.count) continue;
            expect(lesson.check({ count: n }, step), `${step.id} ${n}`).toEqual({ correct: false, highlight: null });
          }
        } else {
          const a = step.answer;
          expect(lesson.check([a[1], a[0], a[2]], step)).toEqual({ correct: false, highlight: 0 });
          expect(lesson.check([a[0], a[2], a[1]], step)).toEqual({ correct: false, highlight: 1 });
          expect(lesson.check([a[0], a[1]], step)).toEqual({ correct: false, highlight: 2 });
          expect(lesson.check([...a, a[0]], step)).toEqual({ correct: false, highlight: 3 });
        }
      }
    });
  }
});

describe("6. check() robustness", () => {
  const MALFORMED = [undefined, null, 42, "nope", [], {}, { count: "2" }, [null], NaN, true];
  for (const lesson of ALL) {
    it(lesson.id, () => {
      for (const step of lesson.steps) {
        for (const bad of MALFORMED) {
          let r;
          expect(() => { r = lesson.check(bad, step); }, `${step.id} ${String(bad)}`).not.toThrow();
          expect(r.correct, `${step.id} ${JSON.stringify(bad)}`).toBe(false);
          if (step.mode === "tap") expect(r.highlight).toBe(correctId(step));
          if (step.mode === "drag") expect(r.highlight).toBeNull();
          if (step.mode === "sequence") expect(typeof r.highlight).toBe("number");
        }
      }
      // A malformed step does not make check throw either.
      expect(() => lesson.check("x", undefined)).not.toThrow();
      expect(() => lesson.check("x", {})).not.toThrow();
    });
  }
});

describe("7. state machine invariants", () => {
  const start = (extra = {}) => initialState({ lessonId: "01-shapes", settings: SETTINGS, lessons: LESSONS, ...extra });
  const wrongFor = (step) => (step.mode === "tap" ? step.choices.find((c) => !c.correct).id
    : step.mode === "drag" ? { count: 0 } : [...step.answer].reverse());
  const answerRight = (s) => reduce(s, { type: "ANSWER", answer: rightAnswer(currentStep(s)) });
  const finishLesson = (s) => {
    const n = s.lessons.find((l) => l.id === s.lessonId).steps.length;
    for (let i = 0; i < n; i++) s = reduce(answerRight(s), { type: "NEXT" });
    return s;
  };

  it("1. reduce never mutates a deep-frozen input state", () => {
    const actions = [
      { type: "ANSWER", answer: "square" }, { type: "ANSWER", answer: "square" }, { type: "RETRY" },
      { type: "ANSWER", answer: "circle" }, { type: "NEXT" }, { type: "SET_SETTINGS", settings: { ...SETTINGS, volume: 0 } },
      { type: "JUMP", lessonId: "02-numbers" }, { type: "NOPE" }, null,
    ];
    let s = start();
    for (const action of actions) {
      const frozen = deepFreeze(s);
      const before = JSON.stringify(frozen);
      const next = reduce(frozen, action);
      expect(JSON.stringify(frozen)).toBe(before);
      s = next;
    }
    // A finished lesson, frozen, through every action again.
    const done = deepFreeze(finishLesson(start()));
    const before = JSON.stringify(done);
    for (const action of actions) reduce(done, action);
    expect(JSON.stringify(done)).toBe(before);
  });

  it("2. stepIndex never exceeds steps.length - 1", () => {
    for (const lesson of LESSONS) {
      const completed = LESSONS.slice(0, LESSONS.indexOf(lesson)).map((l) => l.id);
      let s = initialState({ lessonId: lesson.id, settings: SETTINGS, lessons: LESSONS, completed });
      for (let i = 0; i < lesson.steps.length + 5; i++) {
        s = reduce(answerRight(s), { type: "NEXT" });
        s = reduce(s, { type: "NEXT" });
        expect(s.stepIndex).toBeLessThanOrEqual(lesson.steps.length - 1);
      }
      expect(s.lessonComplete).toBe(true);
      expect(s.stepIndex).toBe(lesson.steps.length - 1);
    }
    expect(start({ stepIndex: 999 }).stepIndex).toBe(shapes.steps.length - 1);
    expect(start({ stepIndex: -3 }).stepIndex).toBe(0);
  });

  it("3. misses never reset except on a correct answer; 2nd miss reveals; no penalty", () => {
    let s = start();
    const wrong = wrongFor(currentStep(s));
    s = reduce(s, { type: "ANSWER", answer: wrong });
    expect(s).toMatchObject({ misses: 1, status: "wrong", revealAnswer: false, highlight: null, reward: null });
    s = reduce(s, { type: "ANSWER", answer: wrong });
    expect(s).toMatchObject({ misses: 2, revealAnswer: true, highlight: "circle", reward: null });
    s = reduce(s, { type: "RETRY" });
    expect(s).toMatchObject({ misses: 2, revealAnswer: false, highlight: null });
    s = reduce(s, { type: "NEXT" });
    s = reduce(s, { type: "SET_SETTINGS", settings: { ...SETTINGS, safe_mode: false } });
    s = reduce(s, { type: "ANSWER", answer: undefined });
    expect(s.misses).toBe(3);
    expect(s.stepIndex).toBe(0);
    s = answerRight(s);
    expect(s).toMatchObject({ misses: 0, status: "correct", pendingAdvance: true, reward: { kind: "task" } });
    // No score field exists to decrease.
    expect(Object.keys(s).some((k) => /score|lock|timer|penalt/i.test(k))).toBe(false);
  });

  it("4. NEXT before a correct answer changes nothing", () => {
    const s = start();
    expect(reduce(s, { type: "NEXT" })).toBe(s);
    const wrong = reduce(s, { type: "ANSWER", answer: "square" });
    expect(reduce(wrong, { type: "NEXT" })).toBe(wrong);
    const revealed = reduce(wrong, { type: "ANSWER", answer: "square" });
    expect(reduce(revealed, { type: "NEXT" })).toBe(revealed);
    const right = answerRight(s);
    expect(reduce(right, { type: "NEXT" }).stepIndex).toBe(1);
    // A second answer after a correct one does not stack another reward.
    expect(reduce(right, { type: "ANSWER", answer: "circle" })).toBe(right);
  });

  it("5. lesson N+1 is reachable only after lesson N is complete", () => {
    let s = start();
    expect(reduce(s, { type: "JUMP", lessonId: "02-numbers" })).toBe(s);
    expect(reduce(s, { type: "JUMP", lessonId: "10-math" })).toBe(s);
    expect(reduce(s, { type: "JUMP", lessonId: "no-such" })).toBe(s);
    s = finishLesson(s);
    expect(s).toMatchObject({ lessonComplete: true, nextLessonId: "02-numbers", reward: { kind: "lesson" }, completed: ["01-shapes"] });
    expect(reduce(s, { type: "JUMP", lessonId: "03-nouns" })).toBe(s);
    const two = reduce(s, { type: "JUMP", lessonId: "02-numbers" });
    expect(two).toMatchObject({ lessonId: "02-numbers", stepIndex: 0, lessonComplete: false, status: "idle", misses: 0 });
    // Back to a completed lesson is fine; forward past the chain still is not.
    expect(reduce(two, { type: "JUMP", lessonId: "01-shapes" }).lessonId).toBe("01-shapes");
    expect(reduce(two, { type: "JUMP", lessonId: "03-nouns" })).toBe(two);
    expect(() => initialState({ lessonId: "03-nouns", settings: SETTINGS, lessons: LESSONS })).toThrow(/locked/);
    // A gap in the completed list unlocks nothing after it, like the server.
    expect(unlockedIds(LESSONS, ["01-shapes", "03-nouns"])).toEqual(["01-shapes", "02-numbers"]);
    // The last lesson completes with no next lesson.
    let last = initialState({ lessonId: "10-math", settings: SETTINGS, lessons: LESSONS, completed: LESSON_ORDER.slice(0, 9) });
    last = finishLesson(last);
    expect(last).toMatchObject({ lessonComplete: true, nextLessonId: null });
  });

  it("SET_SETTINGS replaces settings and leaves progress alone", () => {
    const s = answerRight(reduce(start(), { type: "ANSWER", answer: "square" }));
    const t = reduce(s, { type: "SET_SETTINGS", settings: { ...SETTINGS, volume: 10 } });
    expect(t.settings.volume).toBe(10);
    const { settings: a, ...restA } = s;
    const { settings: b, ...restB } = t;
    expect(restB).toEqual(restA);
  });
});

describe("8. reward budget, WCAG 2.3.1", () => {
  const matrix = [];
  for (const kind of ["task", "lesson"])
    for (const flash_intensity of [0, 50, 100])
      for (const animation_speed of [0.25, 1, 2])
        for (const safe_mode of [true, false])
          for (const animations of [true, false])
            for (const contrast of ["normal", "high"])
              for (const volume of [0, 60, 100])
                matrix.push({ kind, settings: { volume, flash_intensity, animation_speed, contrast, animations, safe_mode } });

  it(`holds across the full matrix (${matrix.length} combinations, each also with reduced: true)`, () => {
    let sawFlashes = 0;
    for (const { kind, settings } of matrix) {
      const label = JSON.stringify({ kind, ...settings });
      const plan = planReward({ kind, settings });
      expect(plan.kind).toBe(kind);
      expect(flashRate(plan.events), label).toBeLessThanOrEqual(3);
      expect(violatesFlashBudget(plan), label).toBe(false);
      if (flashRate(plan.events) > 0) sawFlashes++;
      if (settings.safe_mode) {
        expect(flashRate(plan.events), label).toBe(0);
        expect(plan.events.some((e) => e.fullScreen), label).toBe(false);
        expect(plan.events.every((e) => e.luminanceDelta < 0.10), label).toBe(true);
        expect(plan.events.every((e) => e.type === "glow" || e.type === "pulse"), label).toBe(true);
      }
      if (settings.contrast === "high") {
        expect(plan.events.every((e) => e.luminanceDelta < 0.10), label).toBe(true);
      }
      if (!settings.animations) {
        expect(plan.events, label).toEqual([]);
        expect(plan.sound, label).toBeDefined();
      }
      expect(plan.sound.gain, label).toBeLessThanOrEqual(0.3);
      expect(plan.sound.enabled, label).toBe(settings.volume > 0);
      expect(plan.sound.notes.length, label).toBeGreaterThan(0);
      for (const e of plan.events) {
        expect(["burst", "confetti", "pulse", "glow"]).toContain(e.type);
        expect(e.luminanceDelta).toBeGreaterThanOrEqual(0);
        expect(e.luminanceDelta).toBeLessThanOrEqual(1);
      }

      const reduced = planReward({ kind, settings, reduced: true });
      expect(reduced.events, label).toEqual([]);
      expect(reduced.reduced).toBe(true);
      expect(reduced.sound).toEqual(planReward({ kind, settings: { ...settings, animations: false } }).sound);
      expect(violatesFlashBudget(reduced)).toBe(false);
    }
    // The matrix does reach the cap, so the <= 3 assertion is not vacuous.
    expect(sawFlashes).toBeGreaterThan(0);
    const worst = planReward({ kind: "lesson", settings: { ...SETTINGS, safe_mode: false, flash_intensity: 100, animation_speed: 2 } });
    expect(flashRate(worst.events)).toBe(3);
  });

  it("speed cannot buy flashes: flash-eligible events stay >= 400 ms apart at speed 2", () => {
    const plan = planReward({ kind: "lesson", settings: { ...SETTINGS, safe_mode: false, flash_intensity: 100, animation_speed: 2 } });
    const ats = plan.events.filter((e) => e.luminanceDelta >= 0.1).map((e) => e.at);
    for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(400);
    // Speed still does its job: durations do shorten.
    expect(Math.max(...plan.events.map((e) => e.durationMs))).toBeLessThan(
      Math.max(...planReward({ kind: "lesson", settings: { ...SETTINGS, safe_mode: false, flash_intensity: 100 } }).events.map((e) => e.durationMs)));
  });

  it("negative case: 4 flashes inside one second is caught", () => {
    const events = [0, 100, 200, 300].map((at) => ({ type: "burst", at, durationMs: 80, luminanceDelta: 0.5, fullScreen: false }));
    expect(flashRate(events)).toBe(4);
    expect(violatesFlashBudget({ events })).toBe(true);
    // Window edges: four flashes spread over exactly 1000 ms still count as 4.
    const edge = [0, 333, 666, 1000].map((at) => ({ type: "burst", at, durationMs: 80, luminanceDelta: 0.5, fullScreen: false }));
    expect(flashRate(edge)).toBe(4);
    // 400 ms spacing is 3 in any window.
    expect(flashRate([0, 400, 800, 1200].map((at) => ({ at, luminanceDelta: 0.5 })))).toBe(3);
    // Below-threshold events never count.
    expect(flashRate([0, 1, 2, 3, 4].map((at) => ({ at, luminanceDelta: 0.09 })))).toBe(0);
  });

  it("negative case: in safe mode any full-screen or >= 0.10 change is a violation", () => {
    const fullScreen = { safeMode: true, events: [{ type: "glow", at: 0, durationMs: 300, luminanceDelta: 0.05, fullScreen: true }] };
    expect(violatesFlashBudget(fullScreen)).toBe(true);
    const big = { safeMode: true, events: [{ type: "glow", at: 0, durationMs: 300, luminanceDelta: 0.1, fullScreen: false }] };
    expect(violatesFlashBudget(big)).toBe(true);
    expect(violatesFlashBudget({ ...big, safeMode: false })).toBe(false);
    expect(violatesFlashBudget({ events: [{ at: NaN, luminanceDelta: 0.5 }] })).toBe(true);
  });

  it("missing or partial settings fall back to the safe defaults", () => {
    for (const settings of [undefined, null, {}, { safe_mode: undefined }, { safe_mode: "no" }]) {
      const plan = planReward({ kind: "lesson", settings });
      expect(plan.safeMode).toBe(true);
      expect(flashRate(plan.events)).toBe(0);
      expect(plan.sound.enabled).toBe(true);
    }
    expect(planReward({ kind: "task", settings: { safe_mode: 0 } }).safeMode).toBe(false);
    expect(planReward({ kind: "task", settings: { volume: 0, safe_mode: true } }).sound.enabled).toBe(false);
  });
});

describe("9. determinism", () => {
  it("planReward with identical input returns deep-equal output", () => {
    for (const kind of ["task", "lesson"]) {
      for (const safe_mode of [true, false]) {
        const input = { kind, settings: { ...SETTINGS, safe_mode, flash_intensity: 100 }, now: 1234 };
        expect(planReward(input)).toEqual(planReward(input));
      }
    }
  });

  it("lessons and render are deterministic: same step, same descriptor", () => {
    for (const l of ALL) {
      const ctx = { index: 0, total: l.steps.length, settings: SETTINGS, isFirst: true, isLast: false };
      expect(l.render(l.steps[0], ctx)).toEqual(l.render(l.steps[0], ctx));
    }
  });
});


describe("lesson 01 coloured variant (combined cue)", () => {
  it("validates under the same contract, same step ids, and every key is a coloured shape", () => {
    const base = LESSONS.find((l) => l.id === "01-shapes");
    const variant = { ...base, steps: colouredSteps };
    expect(() => validateLesson(variant)).not.toThrow();
    expect(colouredSteps.map((s) => s.id)).toEqual(base.steps.map((s) => s.id));
    for (const s of colouredSteps) {
      expect(s.prompt).toMatch(/^Touch the (red|blue|yellow|green|orange|purple) (circle|square|triangle|rectangle|star)\.$/);
      for (const c of s.choices) {
        expect(c.svg).toMatch(/^(circle|square|triangle|rectangle|star)-(red|blue|yellow|green|orange|purple)$/);
        expect(Object.hasOwn(SVG, c.svg)).toBe(true);
        expect(c.label).toContain(c.svg.split("-")[1]); // colour word always in the label
      }
      // distractors differ by shape OR colour, never both: at least one shares an attribute with the answer
      const right = s.choices.find((c) => c.correct);
      const [rs, rc] = right.svg.split("-");
      for (const c of s.choices.filter((x) => !x.correct)) {
        const [cs, cc] = c.svg.split("-");
        expect(cs === rs || cc === rc, `${s.id} ${c.svg}`).toBe(true);
      }
    }
  });

  it("every prompt in every lesson says Touch, never Tap", () => {
    for (const l of LESSONS) for (const s of l.steps) {
      expect(s.prompt).not.toMatch(/\bTap\b/);
      expect(s.audio).not.toMatch(/\bTap\b/);
    }
  });
});
