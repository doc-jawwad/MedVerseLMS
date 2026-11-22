import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupIncomingOpenTests,
  OPEN_LIST_UNGROUPED_TITLE,
} from "../../src/lib/dashboard/group-incoming-open-tests.ts";

describe("groupIncomingOpenTests", () => {
  const items = [
    { id: "a", opens_at: "2026-10-10T10:00:00.000Z", title: "A" },
    { id: "b", opens_at: "2026-10-08T10:00:00.000Z", title: "B" },
    { id: "c", opens_at: "2026-10-12T10:00:00.000Z", title: "C" },
    { id: "d", opens_at: "2026-10-09T10:00:00.000Z", title: "D" },
  ];

  it("orders by group sort_order then placement sort_order", () => {
    const sections = groupIncomingOpenTests({
      items,
      groups: [
        { id: "g2", name: "Later group", sort_order: 1 },
        { id: "g1", name: "First group", sort_order: 0 },
      ],
      placements: [
        { test_id: "a", group_id: "g1", sort_order: 1 },
        { test_id: "b", group_id: "g1", sort_order: 0 },
        { test_id: "c", group_id: "g2", sort_order: 0 },
      ],
    });

    assert.equal(sections.length, 3);
    assert.equal(sections[0]!.title, "First group");
    assert.deepEqual(
      sections[0]!.items.map((i) => i.id),
      ["b", "a"]
    );
    assert.equal(sections[1]!.title, "Later group");
    assert.deepEqual(
      sections[1]!.items.map((i) => i.id),
      ["c"]
    );
    assert.equal(sections[2]!.title, OPEN_LIST_UNGROUPED_TITLE);
    assert.deepEqual(
      sections[2]!.items.map((i) => i.id),
      ["d"]
    );
  });

  it("keeps ungrouped tests via opens_at fallback when no placements exist", () => {
    const sections = groupIncomingOpenTests({
      items,
      groups: [],
      placements: [],
    });
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.groupId, null);
    assert.deepEqual(
      sections[0]!.items.map((i) => i.id),
      ["b", "d", "a", "c"]
    );
  });

  it("treats orphan group_id as ungrouped (never drops the test)", () => {
    const sections = groupIncomingOpenTests({
      items: [{ id: "x", opens_at: "2026-10-01T00:00:00.000Z" }],
      groups: [],
      placements: [{ test_id: "x", group_id: "missing", sort_order: 0 }],
    });
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.groupId, null);
    assert.equal(sections[0]!.items[0]!.id, "x");
  });

  it("does not invent closed-test membership (caller supplies incoming only)", () => {
    const sections = groupIncomingOpenTests({
      items: [{ id: "open", opens_at: "2026-10-01T00:00:00.000Z" }],
      groups: [{ id: "g", name: "G", sort_order: 0 }],
      placements: [
        { test_id: "open", group_id: "g", sort_order: 0 },
        { test_id: "closed-not-incoming", group_id: "g", sort_order: 1 },
      ],
    });
    assert.equal(sections[0]!.items.length, 1);
    assert.equal(sections[0]!.items[0]!.id, "open");
  });
});
