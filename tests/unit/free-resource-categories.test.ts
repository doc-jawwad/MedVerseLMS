import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFreeResourceCategories } from "../../src/lib/library/free-categories.ts";

describe("buildFreeResourceCategories", () => {
  it("omits empty types and only includes accessible free items", () => {
    const cards = buildFreeResourceCategories({
      practice: [
        { subject_id: "s1", granted: true, approved_questions: 20 },
        { subject_id: "s2", granted: false, approved_questions: 100 },
        { subject_id: "s3", granted: true, approved_questions: 0 },
      ],
      folders: [
        {
          id: "f-guide",
          library_type: "guidelines",
          subject_id: "s1",
          updated_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "f-books",
          library_type: "books",
          subject_id: "s1",
          updated_at: "2026-09-02T00:00:00Z",
        },
        {
          id: "f-notes",
          library_type: "notes",
          subject_id: "s1",
          updated_at: "2026-09-03T00:00:00Z",
        },
      ],
      accessibleFolderIds: ["f-guide", "f-notes"],
      materials: [
        { folder_id: "f-guide", updated_at: "2026-09-10T00:00:00Z" },
        { folder_id: "f-guide", updated_at: "2026-09-11T00:00:00Z" },
        { folder_id: "f-books", updated_at: "2026-09-12T00:00:00Z" },
      ],
      pearls: [
        { id: "p1", subject_id: "s1", updated_at: "2026-09-08T00:00:00Z" },
        { id: "p2", subject_id: "s2", updated_at: "2026-09-09T00:00:00Z" },
      ],
      accessiblePearlIds: ["p1"],
    });

    assert.deepEqual(
      cards.map((c) => c.id),
      ["mcq_bank", "pearl_points", "guidelines"]
    );
    assert.equal(cards[0]?.itemCount, 20);
    assert.equal(cards[0]?.subjectCount, 1);
    assert.equal(cards[1]?.itemCount, 1);
    assert.equal(cards[2]?.itemCount, 2);
    assert.ok(!cards.some((c) => c.id === "books"));
    assert.ok(!cards.some((c) => c.id === "notes"));
  });
});
