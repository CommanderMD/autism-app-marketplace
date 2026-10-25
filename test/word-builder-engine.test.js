import { describe, it, expect } from "vitest";
import {
  LADDERS, EXAMPLE_LADDER, RUNGS, WORD_LENGTH, CLUE_LEVELS,
  validateLadders, validateLadder, hamming,
} from "../public/apps/word-builder/engine/ladders.js";
import {
  APP_ID, BANK_SIZE, HINT_LEVELS,
  buildBank, checkAnswer, initialState, reduce, placedWord, selectableRungs, solvedCount,
  progressPayload, listView, ladderView, exampleSteps,
} from "../public/apps/word-builder/engine/game.js";

// Word Builder engine: the ladder rules, played in Node. No DOM, no markup.

const clone = (x) => JSON.parse(JSON.stringify(x));
const sortLetters = (s) => [...s].sort().join("");
const good = () => clone(LADDERS[0]);

// Tap the bank tiles that spell `word`, in order.
function build(state, word) {
  let s = state;
  const used = new Set();
  for (const letter of word) {
    const tile = s.bank.find((t) => t.letter === letter && !used.has(t.id));
    if (!tile) throw new Error(`no tile ${letter} for ${word}`);
    used.add(tile.id);
    s = reduce(s, { type: "TILE", tile: tile.id });
  }
  return s;
}

describe("shipped ladders", () => {
  it("validateLadders accepts the shipped set; 8 ladders, frozen", () => {
    expect(() => validateLadders(LADDERS)).not.toThrow();
    expect(LADDERS).toHaveLength(8);
    expect(Object.isFrozen(LADDERS)).toBe(true);
    expect(Object.isFrozen(LADDERS[0].rungs[0].clues)).toBe(true);
    expect(() => validateLadder(EXAMPLE_LADDER)).not.toThrow();
  });

  it("every ladder has 5 distinct 4-letter uppercase words and all three clue levels", () => {
    for (const l of LADDERS) {
      expect(l.rungs, l.id).toHaveLength(RUNGS);
      expect(new Set(l.rungs.map((r) => r.word)).size, l.id).toBe(RUNGS);
      for (const r of l.rungs) {
        expect(r.word).toMatch(/^[A-Z]{4}$/);
        for (const level of CLUE_LEVELS) expect(r.clues[level].trim().length, `${l.id} ${r.word} ${level}`).toBeGreaterThan(0);
      }
    }
  });

  it("the changing column varies between ladders", () => {
    expect(new Set(LADDERS.map((l) => l.changeIndex)).size).toBe(WORD_LENGTH);
  });

  it("every ladder has a solvable path from rung 0 to rung 4 (walk the array)", () => {
    for (const l of [...LADDERS, EXAMPLE_LADDER]) {
      for (let i = 1; i < l.rungs.length; i++) {
        const a = l.rungs[i - 1].word;
        const b = l.rungs[i].word;
        expect(hamming(a, b), `${l.id} ${a}->${b}`).toBe(1);
        for (let k = 0; k < WORD_LENGTH; k++) if (k !== l.changeIndex) expect(b[k]).toBe(a[k]);
      }
      // And the game itself can be played top to bottom with no hints.
      let s = initialState(l, { hint: "none", seed: 7 });
      for (let i = 0; i < RUNGS; i++) {
        expect(s.current, l.id).toBe(i);
        s = build(s, l.rungs[i].word);
        expect(s.solved[i], `${l.id} rung ${i}`).toBe(true);
      }
      expect(s.status).toBe("done");
      expect(s.attempts).toBe(0);
    }
  });
});

describe("validateLadders rejects", () => {
  it("a rung at Hamming distance 2", () => {
    const l = good();
    l.rungs[2].word = "BOKE"; // CAKE LAKE BAKE -> BOKE? no: LAKE -> BOKE is distance 2
    expect(() => validateLadders([l])).toThrow(/ladder "wb-01": rung 2 \("BOKE"\) is Hamming distance 2 from rung 1 \("LAKE"\)/);
  });

  it("a one-letter change in the wrong column", () => {
    const l = good();
    l.rungs[1].word = "CARE"; // CAKE -> CARE changes column 2, ladder says 0
    expect(() => validateLadders([l])).toThrow(/ladder "wb-01": rung 1 \("CARE"\) changes letter 2 .* changeIndex is 0/);
  });

  it("a word that is not 4 letters", () => {
    const l = good();
    l.rungs[3].word = "RAKES";
    expect(() => validateLadders([l])).toThrow(/ladder "wb-01": rung 3 \("RAKES"\) word must be exactly 4 letters/);
    const m = good();
    m.rungs[0].word = "cake";
    expect(() => validateLadders([m])).toThrow(/rung 0 \("cake"\) word must be uppercase A-Z/);
  });

  it("a ladder with 4 or with 6 rungs", () => {
    const four = good();
    four.rungs.pop();
    expect(() => validateLadders([four])).toThrow(/ladder "wb-01": has 4 rungs; must have exactly 5/);
    const six = good();
    six.rungs.push({ word: "TAKE", clues: { 1: "a", 2: "b", 3: "c" } });
    expect(() => validateLadders([six])).toThrow(/ladder "wb-01": has 6 rungs; must have exactly 5/);
  });

  it("a duplicate word", () => {
    const l = good();
    l.rungs[2].word = "CAKE"; // LAKE -> CAKE is still one change in column 0
    expect(() => validateLadders([l])).toThrow(/ladder "wb-01": rung 2 \("CAKE"\) duplicates an earlier word/);
  });

  it("a missing or empty clue level", () => {
    const l = good();
    delete l.rungs[4].clues[2];
    expect(() => validateLadders([l])).toThrow(/ladder "wb-01": rung 4 \("MAKE"\) is missing clue level 2/);
    const m = good();
    m.rungs[1].clues[3] = "   ";
    expect(() => validateLadders([m])).toThrow(/rung 1 \("LAKE"\) is missing clue level 3/);
  });

  it("a duplicate ladder id across the set", () => {
    expect(() => validateLadders([good(), good()])).toThrow(/duplicate ladder id "wb-01"/);
  });
});

describe("buildBank", () => {
  it("has 8 tiles that always include the 4 correct letters, for every rung of every ladder", () => {
    for (const l of LADDERS) {
      l.rungs.forEach((r, i) => {
        for (const seed of [0, 1, 42, 2 ** 31, 4294967295]) {
          const bank = buildBank(l, i, seed);
          expect(bank).toHaveLength(BANK_SIZE);
          expect(bank.map((t) => t.id)).toEqual([...Array(BANK_SIZE).keys()]);
          const pool = bank.map((t) => t.letter);
          for (const letter of r.word) {
            const k = pool.indexOf(letter);
            expect(k, `${l.id} ${r.word} seed ${seed}`).not.toBe(-1);
            pool.splice(k, 1); // multiset: HOOK needs two O tiles
          }
        }
      });
    }
  });

  it("is deterministic per seed, and differs across seeds", () => {
    const l = LADDERS[1];
    expect(buildBank(l, 2, 12345)).toEqual(buildBank(l, 2, 12345));
    const orders = new Set(Array.from({ length: 20 }, (_, s) => buildBank(l, 2, s).map((t) => t.letter).join("")));
    expect(orders.size).toBeGreaterThan(5);
  });

  it("includes a letter that builds a plausible-but-wrong real word", () => {
    for (const l of LADDERS) {
      l.rungs.forEach((r, i) => {
        const pool = buildBank(l, i, 99).map((t) => t.letter);
        for (const letter of r.word) pool.splice(pool.indexOf(letter), 1); // what is left over
        const decoys = pool.filter((x) => {
          const w = r.word.slice(0, l.changeIndex) + x + r.word.slice(l.changeIndex + 1);
          return w !== r.word && l.rungs.some((o) => o.word === w);
        });
        expect(decoys.length, `${l.id} ${r.word}`).toBeGreaterThan(0);
      });
    }
  });
});

describe("checkAnswer", () => {
  const l = LADDERS[0]; // CAKE LAKE BAKE RAKE MAKE, column 0

  it("returns correct for the right word", () => {
    expect(checkAnswer(l, 2, "BAKE")).toEqual({ result: "correct", highlight: [] });
    expect(checkAnswer(l, 0, "cake").result).toBe("correct");
  });

  it("returns not-word for a word that is not on the ladder", () => {
    expect(checkAnswer(l, 2, "TAKE").result).toBe("not-word"); // real English, not this ladder
    expect(checkAnswer(l, 2, "KBAE").result).toBe("not-word");
    expect(checkAnswer(l, 2, "").result).toBe("not-word");
    expect(checkAnswer(l, 2, null).result).toBe("not-word");
  });

  it("returns wrong-distance for a real ladder word placed out of order, flagging the column", () => {
    expect(checkAnswer(l, 2, "MAKE")).toEqual({ result: "wrong-distance", highlight: [0] });
    expect(checkAnswer(l, 2, "LAKE")).toEqual({ result: "wrong-distance", highlight: [0] }); // repeats the rung above
    expect(checkAnswer(LADDERS[1], 0, "HOOF")).toEqual({ result: "wrong-distance", highlight: [3] });
  });
});

describe("play rules", () => {
  const l = LADDERS[0];

  it("hint levels: ends gives the top and bottom words, letters and none give nothing filled", () => {
    expect(HINT_LEVELS).toEqual(["ends", "letters", "none"]);
    const ends = initialState(l, { hint: "ends", seed: 1 });
    expect(ends.solved).toEqual([true, false, false, false, true]);
    expect(ends.current).toBe(1);
    const view = ladderView(ends);
    expect(view.rungs[0]).toMatchObject({ state: "given", word: "CAKE" });
    expect(view.rungs[4]).toMatchObject({ state: "given", word: "MAKE" });
    expect(view.rungs[2].word).toBeNull();

    const letters = ladderView(initialState(l, { hint: "letters", seed: 1 }));
    expect(letters.rungs.map((r) => r.word)).toEqual([null, null, null, null, null]);
    expect(letters.rungs.map((r) => r.hintLetter)).toEqual(["C", null, null, null, "M"]);

    const none = ladderView(initialState(l, { hint: "none", seed: 1 }));
    expect(none.rungs.every((r) => r.word === null && r.hintLetter === null)).toBe(true);
  });

  it("clue level picks the clue text", () => {
    const s = initialState(l, { hint: "none", seed: 1 });
    for (const level of [1, 2, 3]) expect(ladderView(s, { clue: level }).clue).toBe(l.rungs[0].clues[level]);
    expect(ladderView(s, { clue: 9 }).clue).toBe(l.rungs[0].clues[1]);
  });

  it("tapping a placed tile removes it; clear empties the rung; a 5th tile is ignored", () => {
    let s = initialState(l, { hint: "none", seed: 3 });
    const [a, b] = s.bank;
    s = reduce(s, { type: "TILE", tile: a.id });
    s = reduce(s, { type: "TILE", tile: b.id });
    expect(s.placed).toEqual([a.id, b.id]);
    s = reduce(s, { type: "TILE", tile: a.id });
    expect(s.placed).toEqual([b.id]);
    s = reduce(s, { type: "REMOVE", slot: 0 });
    expect(s.placed).toEqual([]);
    s = reduce(s, { type: "TILE", tile: a.id });
    s = reduce(s, { type: "CLEAR" });
    expect(s.placed).toEqual([]);
    expect(reduce(s, { type: "CLEAR" })).toBe(s);
  });

  it("a wrong word keeps the tiles, counts an attempt, and never ends the game", () => {
    let s = initialState(l, { hint: "none", seed: 5 });
    const four = s.bank.filter((t) => !"CAKE".includes(t.letter) || t.letter === "E").slice(0, 4);
    for (const t of four) s = reduce(s, { type: "TILE", tile: t.id });
    expect(s.placed).toHaveLength(4);
    expect(s.feedback.result).not.toBe("correct");
    expect(s.attempts).toBe(1);
    expect(s.status).toBe("playing");
    expect(s.solved[0]).toBe(false);
    expect(reduce(s, { type: "TILE", tile: s.bank.find((t) => !s.placed.includes(t.id)).id })).toBe(s);
  });

  it("an out-of-order ladder word reports wrong-distance with the column", () => {
    let s = initialState(l, { hint: "ends", seed: 8 }); // on rung 1 (LAKE); bank has neighbour letters C and B
    s = build(s, "CAKE");
    expect(s.feedback).toMatchObject({ result: "wrong-distance", highlight: [0], word: "CAKE" });
    expect(s.attempts).toBe(1);
  });

  it("either end: a child can build from the bottom up", () => {
    let s = initialState(l, { hint: "none", seed: 2 });
    expect(selectableRungs(s.solved)).toEqual([0, 4]);
    expect(reduce(s, { type: "SELECT", rung: 2 })).toBe(s); // not next to a filled rung
    s = reduce(s, { type: "SELECT", rung: 4 });
    expect(s.current).toBe(4);
    s = build(s, "MAKE");
    expect(s.current).toBe(3);
    for (const i of [3, 2, 1, 0]) s = build(s, l.rungs[i].word);
    expect(s.status).toBe("done");
    expect(solvedCount(s)).toBe(5);
  });

  it("RESTART plays the same ladder again from the top", () => {
    let s = initialState(l, { hint: "ends", seed: 4 });
    for (const i of [1, 2, 3]) s = build(s, l.rungs[i].word);
    expect(s.status).toBe("done");
    const again = reduce(s, { type: "RESTART", seed: 11 });
    expect(again.status).toBe("playing");
    expect(again.ladder.id).toBe(l.id);
    expect(again.solved).toEqual([true, false, false, false, true]);
    expect(placedWord(again)).toBe("");
  });

  it("the view never carries an unfilled word", () => {
    const s = initialState(LADDERS[2], { hint: "none", seed: 1 });
    const json = JSON.stringify(ladderView(s));
    for (const r of LADDERS[2].rungs) expect(json).not.toContain(`"${r.word}"`);
  });
});

describe("list and example", () => {
  it("unlocks in order; done ladders stay playable", () => {
    expect(listView([]).map((x) => x.state)).toEqual(["open", "locked", "locked", "locked", "locked", "locked", "locked", "locked"]);
    const v = listView(["wb-01", "wb-02", "wb-05"]);
    // wb-05 is done out of order (replayed after a reset, say): it stays playable and opens wb-06.
    expect(v.map((x) => x.state)).toEqual(["done", "done", "open", "locked", "done", "open", "locked", "locked"]);
  });

  it("the worked example names the changed letter on every rung", () => {
    const steps = exampleSteps(EXAMPLE_LADDER);
    expect(steps).toHaveLength(5);
    expect(steps[0]).toMatchObject({ word: "TAIL", at: null });
    expect(steps[1]).toMatchObject({ from: "TAIL", word: "SAIL", at: 0, was: "T", now: "S" });
    for (const s of steps.slice(1)) expect(s.at).toBe(EXAMPLE_LADDER.changeIndex);
    expect(LADDERS.some((l) => l.id === EXAMPLE_LADDER.id)).toBe(false);
  });
});

describe("progress payload", () => {
  it("is written under app_id 'word-builder', the ladder id and the rung", () => {
    expect(APP_ID).toBe("word-builder");
    const body = progressPayload({ childId: "c1", ladderId: "wb-03", step: 3, completed: false, seconds: 12.4 });
    expect(body).toEqual({ child_id: "c1", app_id: "word-builder", lesson_id: "wb-03", step_index: 3, completed: false, seconds: 12 });
    expect(body.app_id).not.toBe("act1-sensory-learning");
    const done = progressPayload({ childId: "c1", ladderId: "wb-03", step: 9, completed: true, seconds: 9999 });
    expect(done).toMatchObject({ app_id: "word-builder", step_index: 5, completed: true, seconds: 600 });
  });
});
