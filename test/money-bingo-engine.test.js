import { describe, it, expect } from "vitest";
import {
  APP_ID, LESSON_ID, ROWS, COLS, CELLS, LINES, LINE_COUNT,
  mulberry32, boardFor, shuffleDeck, findLines, initialState, reduce, currentCall, cellOf, progressPayload,
} from "../public/apps/money-bingo/engine/bingo.js";
import { ITEMS, ITEM_IDS } from "../public/apps/money-bingo/engine/items.js";
import { MONEY_SVG, validateMoneySvg, moneySvgFor } from "../public/apps/money-bingo/engine/money-svg.js";

// Money Bingo engine: the game rules, played in Node. No DOM, no markup.

const EXPECTED_IDS = [
  "penny", "nickel", "dime", "quarter",
  "one-dollar", "five-dollars", "ten-dollars", "twenty-dollars",
  "dollar-sign", "cent-sign",
  "wallet", "purse", "piggy-bank", "spend", "save",
];
const sorted = (a) => [...a].sort();

// Start a game and tap whatever is called, `n` times (or until a line).
function playCorrect(state, n) {
  let s = state;
  for (let k = 0; k < n && s.status === "playing"; k++) {
    s = reduce(s, { type: "TAP", cell: cellOf(s, currentCall(s)) });
  }
  return s;
}

describe("item set and SVG library", () => {
  it("has exactly the 15 specified items, each with id, audio and an svg key", () => {
    expect(ITEMS).toHaveLength(15);
    expect(sorted(ITEM_IDS)).toEqual(sorted(EXPECTED_IDS));
    for (const item of ITEMS) {
      expect(typeof item.audio).toBe("string");
      expect(item.audio.length).toBeGreaterThan(0);
      expect(moneySvgFor(item.svg), item.id).not.toBeNull();
    }
  });

  it("validateMoneySvg passes for the real library and throws on a missing or malformed key", () => {
    expect(validateMoneySvg()).toBe(true);
    const { penny, ...withoutPenny } = MONEY_SVG;
    expect(() => validateMoneySvg(withoutPenny)).toThrow(/missing key "penny"/);
    expect(() => validateMoneySvg({ ...MONEY_SVG, dime: "<svg></svg>" })).toThrow(/"dime"/);
    const sneaky = MONEY_SVG.nickel.replace("</svg>", '<image href="x"/></svg>');
    expect(() => validateMoneySvg({ ...MONEY_SVG, nickel: sneaky })).toThrow(/forbidden/);
    expect(Object.isFrozen(MONEY_SVG)).toBe(true);
  });
});

describe("seeded boards and deck", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("boardFor(seed) returns 15 unique items, and the same seed returns an identical board", () => {
    const board = boardFor(12345);
    expect(board).toHaveLength(15);
    expect(new Set(board).size).toBe(15);
    expect(boardFor(12345)).toEqual(board);
  });

  it("two different seeds produce different boards", () => {
    expect(boardFor(1)).not.toEqual(boardFor(2));
    // And across many seeds, boards are not all the same order.
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => boardFor(i).join(",")));
    expect(distinct.size).toBeGreaterThan(15);
  });

  it("every board contains exactly the 15-item set", () => {
    for (const seed of [0, 1, 7, 99, 2 ** 31, 4294967295, 123456789]) {
      expect(sorted(boardFor(seed))).toEqual(sorted(EXPECTED_IDS));
    }
  });

  it("shuffleDeck(seed) is the 15 items, de-duplicated, reproducible, and not the board order", () => {
    const deck = shuffleDeck(555);
    expect(deck).toHaveLength(15);
    expect(sorted(deck)).toEqual(sorted(EXPECTED_IDS));
    expect(shuffleDeck(555)).toEqual(deck);
    expect(shuffleDeck(555, 0, ["penny", "penny", "dime"])).toHaveLength(2);
    // Independent stream from the board for the same seed (checked over seeds).
    const same = [1, 2, 3, 4, 5].filter((s) => shuffleDeck(s).join() === boardFor(s).join());
    expect(same).toHaveLength(0);
  });
});

describe("LINES", () => {
  it("is 20 lines of exactly 3 in-range cells, no duplicates within or between lines", () => {
    expect(ROWS).toBe(3);
    expect(COLS).toBe(5);
    expect(CELLS).toBe(15);
    expect(LINES).toHaveLength(20);
    expect(LINE_COUNT).toBe(20);
    for (const line of LINES) {
      expect(line).toHaveLength(3);
      expect(new Set(line).size).toBe(3);
      for (const i of line) {
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(15);
      }
    }
    expect(new Set(LINES.map((l) => [...l].sort((a, b) => a - b).join())).size).toBe(20);
  });

  it("matches every straight run of 3 on a 3x5 grid (9 horizontal, 5 vertical, 6 diagonal)", () => {
    // Derive independently: every start cell and direction whose 3 cells stay on the grid.
    const derived = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
          const cells = [0, 1, 2].map((k) => [r + dr * k, c + dc * k]);
          if (cells.every(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS)) {
            derived.push(cells.map(([rr, cc]) => rr * COLS + cc).sort((a, b) => a - b).join());
          }
        }
      }
    }
    expect(sorted(LINES.map((l) => [...l].sort((a, b) => a - b).join()))).toEqual(sorted(derived));
    const kind = (l) => (l[1] - l[0] === 1 ? "h" : l[1] - l[0] === 5 ? "v" : "d");
    const counts = LINES.reduce((m, l) => ({ ...m, [kind(l)]: (m[kind(l)] || 0) + 1 }), {});
    expect(counts).toEqual({ h: 9, v: 5, d: 6 });
  });
});

describe("win detection", () => {
  it("a full column is a win", () => {
    expect(findLines([1, 6, 11])).toEqual([[1, 6, 11]]);
  });

  it("two scattered cells are not a win", () => {
    expect(findLines([0, 13])).toEqual([]);
    expect(findLines([])).toEqual([]);
  });

  it("a 3-cell diagonal is a win (both directions)", () => {
    expect(findLines([2, 8, 14])).toEqual([[2, 8, 14]]);
    expect(findLines([4, 8, 12])).toEqual([[4, 8, 12]]);
  });

  it("a horizontal run of 3 inside a 5-wide row is a win", () => {
    expect(findLines([11, 12, 13])).toEqual([[11, 12, 13]]);
  });

  it("accepts a Set and ignores order", () => {
    expect(findLines(new Set([10, 0, 5]))).toEqual([[0, 5, 10]]);
  });
});

describe("turns", () => {
  it("nothing is called before Start; START begins play with the first call", () => {
    const s0 = initialState({ seed: 9 });
    expect(s0.status).toBe("ready");
    expect(currentCall(s0)).toBeNull();
    expect(reduce(s0, { type: "TAP", cell: 0 })).toBe(s0);
    const s1 = reduce(s0, { type: "START" });
    expect(s1.status).toBe("playing");
    expect(currentCall(s1)).toBe(s1.deck[0]);
  });

  it("a right tap marks the cell and advances to the next call", () => {
    const s = reduce(initialState({ seed: 21 }), { type: "START" });
    const cell = cellOf(s, currentCall(s));
    const next = reduce(s, { type: "TAP", cell });
    expect(next.marked).toEqual([cell]);
    expect(next.callIndex).toBe(1);
    expect(next.attempts).toBe(1);
    expect(next.hint).toBeNull();
  });

  it("a wrong tap does not mark, does not advance, increments attempts, and hints the right cell", () => {
    const s = reduce(initialState({ seed: 21 }), { type: "START" });
    const right = cellOf(s, currentCall(s));
    const wrong = (right + 1) % 15;
    const next = reduce(s, { type: "TAP", cell: wrong });
    expect(next.marked).toEqual([]);
    expect(next.callIndex).toBe(s.callIndex);
    expect(currentCall(next)).toBe(currentCall(s));
    expect(next.attempts).toBe(s.attempts + 1);
    expect(next.misses).toBe(1);
    expect(next.hint).toBe(right);
    expect(next.status).toBe("playing"); // no fail state
    // The same call is still answerable after any number of misses.
    const after = reduce(reduce(next, { type: "TAP", cell: wrong }), { type: "TAP", cell: right });
    expect(after.marked).toEqual([right]);
    expect(after.hint).toBeNull();
  });

  it("a marked cell stays marked across calls and cannot be re-tapped", () => {
    let s = reduce(initialState({ seed: 77 }), { type: "START" });
    const first = cellOf(s, currentCall(s));
    s = reduce(s, { type: "TAP", cell: first });
    s = playCorrect(s, 1);
    expect(s.marked).toContain(first);
    if (s.status === "playing") {
      expect(reduce(s, { type: "TAP", cell: first })).toBe(s);
    }
  });

  it("a completed line stops on 'bingo' without advancing, and only DECLARE confirms it", () => {
    let s = reduce(initialState({ seed: 3 }), { type: "START" });
    s = playCorrect(s, 15);
    expect(s.status).toBe("bingo");
    expect(s.lines.length).toBeGreaterThan(0);
    for (const line of s.lines) for (const i of line) expect(s.marked).toContain(i);
    const callIndex = s.callIndex;
    // No further taps or calls while waiting for the declaration.
    const unmarked = [...Array(15).keys()].find((i) => !s.marked.includes(i));
    expect(reduce(s, { type: "TAP", cell: unmarked })).toBe(s);
    expect(s.callIndex).toBe(callIndex);
    const declared = reduce(s, { type: "DECLARE" });
    expect(declared.status).toBe("declared");
    expect(declared.wins).toBe(1);
  });

  it("DECLARE before a line does nothing", () => {
    const s = reduce(initialState({ seed: 3 }), { type: "START" });
    expect(reduce(s, { type: "DECLARE" })).toBe(s);
  });

  it("after a win: SAME_BOARD replays the seed, NEW_BOARD uses the new seed; wins carry over", () => {
    let s = playCorrect(reduce(initialState({ seed: 8 }), { type: "START" }), 15);
    s = reduce(s, { type: "DECLARE" });
    const same = reduce(s, { type: "SAME_BOARD" });
    expect(same.board).toEqual(boardFor(8));
    expect(same.marked).toEqual([]);
    expect(same.status).toBe("playing");
    expect(same.wins).toBe(1);
    const fresh = reduce(s, { type: "NEW_BOARD", seed: 9001 });
    expect(fresh.seed).toBe(9001);
    expect(fresh.board).toEqual(boardFor(9001));
    expect(fresh.wins).toBe(1);
  });

  it("every seed reaches a line by playing the calls (no dead ends)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = playCorrect(reduce(initialState({ seed }), { type: "START" }), 15);
      expect(s.status, `seed ${seed}`).toBe("bingo");
    }
  });
});

describe("deck exhaustion", () => {
  it("running out of calls reshuffles the unmarked items instead of ending", () => {
    // Solo play always finds a line first, so build the edge directly: a
    // two-card deck whose second card is the last one, with no line yet.
    const base = reduce(initialState({ seed: 11 }), { type: "START" });
    const a = base.board[0];
    const b = base.board[13];
    let s = Object.freeze({ ...base, deck: Object.freeze([a, b]), callIndex: 0 });
    s = reduce(s, { type: "TAP", cell: 0 });
    expect(s.callIndex).toBe(1);
    s = reduce(s, { type: "TAP", cell: 13 });
    expect(s.status).toBe("playing");
    expect(s.deckRound).toBe(1);
    expect(s.callIndex).toBe(0);
    expect(s.deck).toHaveLength(13);
    expect(s.deck).not.toContain(a);
    expect(s.deck).not.toContain(b);
    expect(new Set(s.deck).size).toBe(13);
    expect(currentCall(s)).not.toBeNull();
    // Play continues from the reshuffled deck.
    const next = reduce(s, { type: "TAP", cell: cellOf(s, currentCall(s)) });
    expect(next.marked).toHaveLength(3);
  });
});

describe("progress payload", () => {
  it("uses app_id 'money-bingo' and lesson_id 'bingo-session', never Act 1's id", () => {
    const body = progressPayload({ childId: "fake-child-id", wins: 2, seconds: 95.4 });
    expect(APP_ID).toBe("money-bingo");
    expect(LESSON_ID).toBe("bingo-session");
    expect(body).toEqual({
      child_id: "fake-child-id",
      app_id: "money-bingo",
      lesson_id: "bingo-session",
      step_index: 2,
      completed: true,
      seconds: 95,
      activities_completed: 1,
    });
    expect(JSON.stringify(body)).not.toContain("act1-sensory-learning");
  });

  it("clamps seconds and step_index into the API's accepted ranges", () => {
    const body = progressPayload({ childId: "fake-child-id", wins: 5000, seconds: 99999 });
    expect(body.seconds).toBe(600);
    expect(body.step_index).toBe(1000);
    expect(progressPayload({ childId: "x", wins: -1, seconds: -5 })).toMatchObject({ seconds: 0, step_index: 0 });
  });
});
