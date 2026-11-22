import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupTestsPageSection } from "../../src/lib/dashboard/group-incoming-open-tests.ts";

const items = [
  { id: "a", opens_at: "2026-12-03T00:00:00Z" },
  { id: "b", opens_at: "2026-12-01T00:00:00Z" },
  { id: "c", opens_at: "2026-12-02T00:00:00Z" },
];

describe("groupTestsPageSection", () => {
  it("keeps original order and no headings when nothing is grouped", () => {
    const r = groupTestsPageSection({ items, groups: [], placements: [] });
    assert.equal(r.showHeadings, false);
    assert.equal(r.sections.length, 1);
    assert.deepEqual(r.sections[0].items.map((i) => i.id), ["a", "b", "c"]);
  });

  it("orders by group then manual order; ungrouped fall back, none lost", () => {
    const r = groupTestsPageSection({
      items,
      groups: [
        { id: "g2", name: "Block 2", sort_order: 2 },
        { id: "g1", name: "Block 1", sort_order: 1 },
      ],
      placements: [
        { test_id: "a", group_id: "g1", sort_order: 2 },
        { test_id: "b", group_id: "g1", sort_order: 1 },
        { test_id: "stale", group_id: "g2", sort_order: 1 },
      ],
    });
    assert.equal(r.showHeadings, true);
    assert.deepEqual(r.sections.map((s) => s.title), ["Block 1", "Other tests"]);
    assert.deepEqual(r.sections[0].items.map((i) => i.id), ["b", "a"]);
    assert.deepEqual(r.sections[1].items.map((i) => i.id), ["c"]);
  });

  it("keeps input (descending) order for ungrouped tests beside groups; manual order overrides", () => {
    const desc = [
      { id: "a", opens_at: "2026-12-03T00:00:00Z" },
      { id: "c", opens_at: "2026-12-02T00:00:00Z" },
      { id: "b", opens_at: "2026-12-01T00:00:00Z" },
      { id: "d", opens_at: "2026-11-30T00:00:00Z" },
    ];
    const groups = [{ id: "g1", name: "G", sort_order: 1 }];
    const r = groupTestsPageSection({
      items: desc,
      groups,
      placements: [{ test_id: "d", group_id: "g1", sort_order: 1 }],
    });
    assert.deepEqual(r.sections[1].items.map((i) => i.id), ["a", "c", "b"]);
    const m = groupTestsPageSection({
      items: desc,
      groups,
      placements: [
        { test_id: "d", group_id: "g1", sort_order: 1 },
        { test_id: "b", group_id: null, sort_order: 1 },
      ],
    });
    assert.deepEqual(m.sections[1].items.map((i) => i.id), ["b", "a", "c"]);
  });
});
