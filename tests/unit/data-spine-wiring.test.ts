import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapRpcTree,
  productKeyForSubjectName,
} from "../../src/lib/academic-tree/map-rpc-tree.ts";
import {
  fromSpineItemKind,
  toSpineItemKind,
} from "../../src/lib/practice/spine-progress-store.ts";
import { adaptTestLeaderboardRows } from "../../src/lib/leaderboard/from-test-leaderboard.ts";
import { LEADERBOARD_PROJECTION_LIMITS } from "../../src/lib/leaderboard/projection-contract.ts";
import { BLOCK_CATEGORIES } from "../../src/lib/academic-tree/index.ts";

describe("Data Spine practice kind mapping", () => {
  it("maps mcq ↔ question, pearl ↔ pearl, and ospe ↔ ospe", () => {
    assert.equal(toSpineItemKind("mcq"), "question");
    assert.equal(toSpineItemKind("pearl"), "pearl");
    assert.equal(toSpineItemKind("ospe"), "ospe");
    assert.equal(fromSpineItemKind("question"), "mcq");
    assert.equal(fromSpineItemKind("pearl"), "pearl");
    assert.equal(fromSpineItemKind("ospe"), "ospe");
    assert.equal(fromSpineItemKind("other"), null);
  });
});

describe("Data Spine academic tree mapping", () => {
  it("maps RPC subjects into chrome categories and empty prof_session", () => {
    const tree = mapRpcTree(
      {
        surface: "library",
        year_id: "y5",
        year_number: 5,
        year_name: "Final Year MBBS",
        subjects: [
          {
            subject_id: "subj-med",
            name: "Medicine",
            product_key: "medicine",
            locked: true,
            categories: [
              {
                library_type: "notes",
                name: "Notes",
                locked: true,
                placeholder: false,
                folders: [
                  {
                    folder_id: "f1",
                    name: "Day 1",
                    locked: true,
                    parent_id: null,
                    library_type: "notes",
                  },
                ],
              },
              {
                library_type: "ospe",
                name: "OSPE",
                locked: false,
                folders: [],
              },
              {
                library_type: "flashcards",
                name: "Flashcards",
                locked: false,
                placeholder: true,
                folders: [],
              },
              {
                library_type: "test",
                name: "Test",
                locked: false,
                folders: [],
              },
            ],
          },
        ],
      },
      {
        surface: "library",
        year_id: "y5",
        year_number: 5,
        year_name: "Final Year MBBS",
        has_live_subscription: false,
      }
    );

    assert.ok(tree);
    assert.equal(tree!.from_adapter, false);
    assert.equal(tree!.subjects.length, 4);
    const medicine = tree!.subjects.find((s) => s.product_key === "medicine");
    assert.ok(medicine);
    assert.equal(medicine!.locked, true);
    assert.equal(medicine!.categories.length, BLOCK_CATEGORIES.length);
    assert.ok(!medicine!.categories.some((c) => c.id === "notes"));
    assert.ok(
      medicine!.categories.some((c) => c.id === "ospe_material"),
      "legacy ospe remaps to ospe_material"
    );
    assert.ok(!medicine!.categories.some((c) => (c.id as string) === "flashcards"));
    assert.ok(!medicine!.categories.some((c) => (c.id as string) === "test"));
    assert.ok(tree!.prof_session);
    assert.deepEqual(tree!.prof_session.subjects, []);
    assert.equal(tree!.prof_session.locked, true);
  });

  it("resolves known product keys from display names only (no year invent)", () => {
    assert.equal(productKeyForSubjectName("Block 3", 1), "block-3");
    assert.equal(productKeyForSubjectName("Surgery", 5), "surgery");
    assert.equal(productKeyForSubjectName("Anatomy", 1), null);
  });
});

describe("leaderboard projection field allow-list", () => {
  it("keeps only safe projection fields from spine-shaped rows", () => {
    const rows = adaptTestLeaderboardRows(
      [
        {
          rank: 1,
          student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          full_name: "Ada",
          college_name: "KE",
          avatar_object_key: "study-content/avatars/a/b",
          score: 88,
          email: "secret@example.com",
          percentile: 99,
        },
      ],
      LEADERBOARD_PROJECTION_LIMITS.dashboardTop
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]!).sort(), [
      "avatar_object_key",
      "college_name",
      "full_name",
      "rank",
      "score",
      "student_id",
    ]);
  });
});
