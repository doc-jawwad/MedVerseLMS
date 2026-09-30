import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accuracyPercent,
  buildSessionReport,
  bumpSessionStats,
  clampIndex,
  completionPercent,
  deckCompletionPercent,
  filterCounts,
  filterDeck,
  markItemDone,
  matchesFilter,
  mergeDeck,
  navigateIndex,
  orderItemIds,
  replaceDeckItem,
  resetDoneInDeck,
  resolveIndexAfterChange,
  setItemMarked,
  setItemState,
  shuffleIds,
  toggleItemMarked,
} from "../../src/lib/practice/engine.ts";
import { createMemoryProgressStore } from "../../src/lib/practice/memory-progress-store.ts";
import {
  elapsedMs,
  formatElapsed,
  formatReportDuration,
} from "../../src/lib/practice/timer.ts";
import type { PracticeDeckItem } from "../../src/lib/practice/types.ts";

function item(
  id: string,
  state: "remaining" | "done" = "remaining",
  marked = false
): PracticeDeckItem {
  return { itemId: id, itemKind: "mcq", state, marked };
}

describe("practice state transitions", () => {
  it("defaults missing progress to remaining unmarked", () => {
    const deck = mergeDeck(["a", "b"], "mcq", [], "stu");
    assert.deepEqual(deck, [
      item("a"),
      item("b"),
    ]);
  });

  it("merges stored done/marked onto catalog ids", () => {
    const deck = mergeDeck(
      ["a", "b", "c"],
      "mcq",
      [
        {
          studentId: "stu",
          itemKind: "mcq",
          itemId: "b",
          state: "done",
          marked: true,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      "stu"
    );
    assert.equal(deck[1]!.state, "done");
    assert.equal(deck[1]!.marked, true);
    assert.equal(deck[0]!.state, "remaining");
  });

  it("marks remaining → done without clearing marked", () => {
    const marked = setItemMarked(item("a"), true);
    const done = markItemDone(marked);
    assert.equal(done.state, "done");
    assert.equal(done.marked, true);
  });

  it("setItemState can return done → remaining", () => {
    assert.equal(setItemState(item("a", "done"), "remaining").state, "remaining");
  });
});

describe("practice filters", () => {
  const deck = [
    item("a", "remaining", false),
    item("b", "done", false),
    item("c", "remaining", true),
    item("d", "done", true),
  ];

  it("matches each filter correctly", () => {
    assert.equal(matchesFilter(deck[0]!, "all"), true);
    assert.equal(matchesFilter(deck[0]!, "remaining"), true);
    assert.equal(matchesFilter(deck[1]!, "remaining"), false);
    assert.equal(matchesFilter(deck[1]!, "done"), true);
    assert.equal(matchesFilter(deck[2]!, "marked"), true);
    assert.equal(matchesFilter(deck[0]!, "marked"), false);
  });

  it("filterDeck returns the expected subsets", () => {
    assert.deepEqual(
      filterDeck(deck, "remaining").map((i) => i.itemId),
      ["a", "c"]
    );
    assert.deepEqual(
      filterDeck(deck, "done").map((i) => i.itemId),
      ["b", "d"]
    );
    assert.deepEqual(
      filterDeck(deck, "marked").map((i) => i.itemId),
      ["c", "d"]
    );
    assert.equal(filterDeck(deck, "all").length, 4);
  });

  it("filterCounts tallies all buckets", () => {
    assert.deepEqual(filterCounts(deck), {
      all: 4,
      remaining: 2,
      done: 2,
      marked: 2,
    });
  });
});

describe("practice favorites (marked)", () => {
  it("toggles Favorites boolean without changing Done", () => {
    const once = toggleItemMarked(item("a", "done"));
    assert.equal(once.marked, true);
    assert.equal(once.state, "done");
    const off = toggleItemMarked(once);
    assert.equal(off.marked, false);
    assert.equal(off.state, "done");
  });

  it("setItemMarked is explicit and independent of state", () => {
    assert.equal(setItemMarked(item("a"), true).marked, true);
    const unfavDone = setItemMarked(item("a", "done", true), false);
    assert.equal(unfavDone.marked, false);
    assert.equal(unfavDone.state, "done");
  });

  it("favorite + done and not-favorite + remaining coexist in filters", () => {
    const deck = [
      item("a", "done", true),
      item("b", "remaining", false),
      item("c", "remaining", true),
    ];
    assert.deepEqual(
      filterDeck(deck, "marked").map((i) => i.itemId),
      ["a", "c"]
    );
    assert.deepEqual(
      filterDeck(deck, "done").map((i) => i.itemId),
      ["a"]
    );
    assert.equal(markItemDone(setItemMarked(item("b"), true)).marked, true);
  });
});

describe("practice reset Done → Remaining", () => {
  it("resets only done items and preserves marked", () => {
    const deck = [
      item("a", "done", true),
      item("b", "remaining", true),
      item("c", "done", false),
    ];
    const reset = resetDoneInDeck(deck);
    assert.equal(reset[0]!.state, "remaining");
    assert.equal(reset[0]!.marked, true);
    assert.equal(reset[1]!.state, "remaining");
    assert.equal(reset[1]!.marked, true);
    assert.equal(reset[2]!.state, "remaining");
    assert.equal(reset[2]!.marked, false);
  });

  it("memory store resetDoneToRemaining does not invent unmarked clears", async () => {
    const store = createMemoryProgressStore([
      {
        studentId: "s",
        itemKind: "pearl",
        itemId: "p1",
        state: "done",
        marked: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        studentId: "s",
        itemKind: "pearl",
        itemId: "p2",
        state: "remaining",
        marked: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const { resetCount } = await store.resetDoneToRemaining({
      studentId: "s",
      itemKind: "pearl",
    });
    assert.equal(resetCount, 1);
    const rows = await store.getMany({ studentId: "s", itemKind: "pearl" });
    const p1 = rows.find((r) => r.itemId === "p1")!;
    assert.equal(p1.state, "remaining");
    assert.equal(p1.marked, true);
  });
});

describe("completion percentage", () => {
  it("returns 0 for empty or zero done", () => {
    assert.equal(completionPercent(0, 0), 0);
    assert.equal(completionPercent(0, 10), 0);
  });

  it("rounds nearest percent", () => {
    assert.equal(completionPercent(1, 3), 33);
    assert.equal(completionPercent(2, 3), 67);
    assert.equal(completionPercent(3, 3), 100);
  });

  it("deckCompletionPercent uses done/all", () => {
    assert.equal(
      deckCompletionPercent([
        item("a", "done"),
        item("b", "remaining"),
        item("c", "done"),
        item("d", "remaining"),
      ]),
      50
    );
  });
});

describe("rapid navigation helpers", () => {
  it("navigates within bounds", () => {
    assert.equal(navigateIndex(0, 5, "previous"), 0);
    assert.equal(navigateIndex(0, 5, "next"), 1);
    assert.equal(navigateIndex(4, 5, "next"), 4);
    assert.equal(navigateIndex(2, 0, "next"), 0);
  });

  it("clamps and resolves index after filter changes", () => {
    assert.equal(clampIndex(9, 3), 2);
    assert.equal(clampIndex(-1, 3), 0);
    const filtered = [item("b"), item("c")];
    assert.equal(resolveIndexAfterChange(filtered, "c", 0), 1);
    assert.equal(resolveIndexAfterChange(filtered, "gone", 9), 1);
    assert.equal(resolveIndexAfterChange([], "a", 0), 0);
  });

  it("replaceDeckItem updates one row", () => {
    const next = replaceDeckItem(
      [item("a"), item("b")],
      item("a", "done", true)
    );
    assert.equal(next[0]!.state, "done");
    assert.equal(next[1]!.itemId, "b");
  });
});

describe("shuffle where appropriate", () => {
  it("orderItemIds preserves sequence when shuffle is off", () => {
    assert.deepEqual(orderItemIds(["a", "b", "c"], false), ["a", "b", "c"]);
  });

  it("shuffleIds is a permutation", () => {
    const ids = ["a", "b", "c", "d"];
    let i = 0;
    const sequence = [0.9, 0.1, 0.5, 0.2];
    const shuffled = shuffleIds(ids, () => sequence[i++] ?? 0);
    assert.equal(shuffled.length, 4);
    assert.ok(ids.every((id) => shuffled.includes(id)));
  });
});

describe("timer calculations", () => {
  it("elapsedMs never goes negative", () => {
    assert.equal(elapsedMs(1000, 500), 0);
    assert.equal(elapsedMs(1000, 1500), 500);
    assert.equal(elapsedMs(Number.NaN, 1), 0);
  });

  it("formatElapsed uses m:ss and h:mm:ss", () => {
    assert.equal(formatElapsed(0), "0:00");
    assert.equal(formatElapsed(65_000), "1:05");
    assert.equal(formatElapsed(3_661_000), "1:01:01");
  });

  it("formatReportDuration is human readable", () => {
    assert.equal(formatReportDuration(5_000), "5s");
    assert.equal(formatReportDuration(65_000), "1m 5s");
    assert.equal(formatReportDuration(3_661_000), "1h 1m 1s");
  });
});

describe("report calculations", () => {
  it("accuracyPercent is 0 with no attempts", () => {
    assert.equal(accuracyPercent(0, 0), 0);
  });

  it("buildSessionReport computes accuracy and clamps", () => {
    const report = buildSessionReport({
      stats: { practiced: 4, correct: 3 },
      timeTakenMs: 90_000,
    });
    assert.deepEqual(report, {
      totalPracticed: 4,
      timeTakenMs: 90_000,
      correct: 3,
      accuracyPercent: 75,
    });
  });

  it("bumpSessionStats records practiced and optional correctness", () => {
    assert.deepEqual(bumpSessionStats({ practiced: 0, correct: 0 }, true), {
      practiced: 1,
      correct: 1,
    });
    assert.deepEqual(bumpSessionStats({ practiced: 1, correct: 1 }, false), {
      practiced: 2,
      correct: 1,
    });
    assert.deepEqual(bumpSessionStats({ practiced: 2, correct: 1 }, null), {
      practiced: 3,
      correct: 1,
    });
  });
});

describe("memory progress store contract", () => {
  it("upserts by student + item_kind + item_id", async () => {
    const store = createMemoryProgressStore();
    await store.setMarked({
      studentId: "s1",
      itemKind: "mcq",
      itemId: "q1",
      marked: true,
    });
    await store.setState({
      studentId: "s1",
      itemKind: "mcq",
      itemId: "q1",
      state: "done",
    });
    const rows = await store.getMany({
      studentId: "s1",
      itemKind: "mcq",
      itemIds: ["q1"],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.marked, true);
    assert.equal(rows[0]!.state, "done");
  });

  it("scopes getMany by kind and does not cross students", async () => {
    const store = createMemoryProgressStore();
    await store.upsert({
      studentId: "s1",
      itemKind: "mcq",
      itemId: "q1",
      state: "done",
    });
    await store.upsert({
      studentId: "s2",
      itemKind: "mcq",
      itemId: "q1",
      state: "remaining",
      marked: true,
    });
    await store.upsert({
      studentId: "s1",
      itemKind: "pearl",
      itemId: "q1",
      state: "done",
    });
    const mcq = await store.getMany({ studentId: "s1", itemKind: "mcq" });
    assert.equal(mcq.length, 1);
    assert.equal(mcq[0]!.itemKind, "mcq");
  });
});
