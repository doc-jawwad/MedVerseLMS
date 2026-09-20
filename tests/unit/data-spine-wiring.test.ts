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

describe("Data Spine practice kind mapping", () => {
  it("maps mcq ↔ question and pearl ↔ pearl", () => {
    assert.equal(toSpineItemKind("mcq"), "question");
    assert.equal(toSpineItemKind("pearl"), "pearl");
    assert.equal(fromSpineItemKind("question"), "mcq");
    assert.equal(fromSpineItemKind("pearl"), "pearl");
    assert.equal(fromSpineItemKind("other"), null);
  });
});

describe("Data Spine academic tree mapping", () => {
  it("maps RPC subjects/categories/folders without inventing content payloads", () => {
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
                library_type: "flashcards",
                name: "Flashcards",
                locked: false,
                placeholder: true,
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
    assert.equal(tree!.subjects.length, 1);
    assert.equal(tree!.subjects[0]?.product_key, "medicine");
    assert.equal(tree!.subjects[0]?.locked, true);
    const notes = tree!.subjects[0]?.categories.find((c) => c.id === "notes");
    assert.ok(notes);
    assert.equal(notes!.folders[0]?.is_day, true);
    assert.deepEqual(notes!.folders[0]?.items, []);
    assert.ok(
      tree!.subjects[0]?.categories.some((c) => c.id === "flashcards")
    );
  });

  it("resolves product keys from subject names", () => {
    assert.equal(productKeyForSubjectName("Block 3", 1), "block-3");
    assert.equal(productKeyForSubjectName("Surgery", 5), "surgery");
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
