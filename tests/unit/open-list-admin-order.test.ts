import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySavedOpenListOrder } from "../../src/lib/dashboard/open-list-admin-order.ts";

describe("applySavedOpenListOrder", () => {
  it("updates persisted group order immediately without mutating input", () => {
    const rows = [{ id: "a", name: "A", sort_order: 0 }, { id: "b", name: "B", sort_order: 1 }];
    const next = applySavedOpenListOrder(rows, ["b", "a"]);
    assert.deepEqual(next.map((r) => r.sort_order), [1, 0]);
    assert.deepEqual([...next].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.id), ["b", "a"]);
    assert.deepEqual(rows.map((r) => r.sort_order), [0, 1]);
    assert.deepEqual(applySavedOpenListOrder(next, ["a", "b"]).map((r) => r.sort_order), [0, 1]);
  });

  it("updates only reordered members and preserves unrelated and unplaced tests", () => {
    const rows = [
      { id: "a", group_id: "g", sort_order: 0 },
      { id: "b", group_id: "g", sort_order: 4 },
      { id: "c", group_id: "other", sort_order: 9 },
      { id: "d", group_id: null, sort_order: null },
    ];
    const next = applySavedOpenListOrder(rows, ["b", "a"]);
    assert.deepEqual(next.map((r) => r.sort_order), [1, 0, 9, null]);
    assert.strictEqual(next[2], rows[2]);
    assert.strictEqual(next[3], rows[3]);
    assert.deepEqual(next.map((r) => r.group_id), rows.map((r) => r.group_id));
  });
});
