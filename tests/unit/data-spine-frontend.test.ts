import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapRpcTree,
  productKeyForSubjectName,
} from "../../src/lib/academic-tree/map-rpc-tree.ts";
import {
  contentBinEntityLabel,
  type ContentBinEntityType,
} from "../../src/lib/content-bin/labels.ts";

describe("mapRpcTree product_key mapping", () => {
  it("uses RPC product_key and ignores departmental subjects", () => {
    const tree = mapRpcTree(
      {
        year_id: "y1",
        year_number: 1,
        year_name: "1st Year MBBS",
        subjects: [
          {
            subject_id: "s-block-1",
            name: "Block 1",
            product_key: "block-1",
            locked: false,
            categories: [],
          },
          {
            subject_id: "s-anatomy",
            name: "Anatomy",
            product_key: null,
            locked: false,
            categories: [],
          },
        ],
        prof_session: { locked: true, subjects: [] },
      },
      {
        surface: "resources",
        year_id: "y1",
        year_number: 1,
        year_name: "1st Year MBBS",
        has_live_subscription: false,
      }
    );

    assert.ok(tree);
    assert.equal(tree!.from_adapter, false);
    assert.deepEqual(
      tree!.subjects.map((s) => s.product_key),
      ["block-1", "block-2", "block-3"]
    );
    assert.equal(tree!.subjects[0]!.subject_id, "s-block-1");
    assert.equal(tree!.subjects[0]!.name, "Block 1");
    assert.equal(tree!.prof_session.subjects.length, 0);
    assert.equal(tree!.prof_session.locked, true);
  });

  it("maps subject-scoped Prof Session days from RPC subjects", () => {
    const dayId = "11111111-1111-1111-1111-111111111111";
    const tree = mapRpcTree(
      {
        year_id: "y1",
        year_number: 1,
        year_name: "1st Year MBBS",
        subjects: [
          {
            subject_id: "s1",
            name: "Block 1",
            product_key: "block-1",
            locked: false,
            categories: [],
          },
        ],
        prof_session: {
          locked: false,
          subjects: [
            {
              subject_id: "s1",
              name: "Block 1",
              product_key: "block-1",
              folders: [
                {
                  folder_id: "f-syl",
                  name: "Syllabus PDF",
                  locked: false,
                  parent_id: null,
                  library_type: "syllabus",
                },
              ],
              days: [
                {
                  day_id: dayId,
                  name: "Foundations Day",
                  sort_order: 1,
                  slots: [
                    { slot_key: "guidelines", name: "Guidelines" },
                    { slot_key: "los", name: "LoS" },
                    { slot_key: "one_liners", name: "One-Liners" },
                    { slot_key: "practice_mcqs", name: "Practice MCQs" },
                    { slot_key: "test_mcq", name: "Test MCQs" },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        surface: "library",
        year_id: "y1",
        year_number: 1,
        year_name: "1st Year MBBS",
        has_live_subscription: true,
      }
    );

    assert.ok(tree);
    assert.equal(tree!.prof_session.locked, false);
    assert.equal(tree!.prof_session.subjects.length, 3);
    const block1 = tree!.prof_session.subjects.find(
      (s) => s.product_key === "block-1"
    );
    assert.ok(block1);
    assert.equal(block1!.days.length, 1);
    assert.equal(block1!.days[0]!.name, "Foundations Day");
    assert.equal(block1!.days[0]!.slug, dayId);
    assert.equal(block1!.days[0]!.children.length, 5);
    assert.ok(
      block1!.days[0]!.children.every((c) => c.day_slot),
      "slots must carry day_slot ids"
    );
    assert.ok(
      block1!.categories.some(
        (c) => c.id === "syllabus" && c.folders.length === 1
      )
    );
    assert.ok(!block1!.days[0]!.children.some((c) => c.day_slot === "syllabus"));
  });

  it("does not invent year-default product keys from departmental names", () => {
    assert.equal(productKeyForSubjectName("Anatomy", 1), null);
    assert.equal(productKeyForSubjectName("Block 4", 2), "block-4");
    assert.equal(productKeyForSubjectName("Medicine", 5), "medicine");
  });
});

describe("content bin entity labels", () => {
  it("labels representative entity types", () => {
    const types: ContentBinEntityType[] = [
      "material",
      "pearl_point",
      "ospe_station",
      "question",
      "prof_session_day",
      "material_folder",
    ];
    for (const t of types) {
      assert.ok(contentBinEntityLabel(t).length > 0);
    }
    assert.equal(contentBinEntityLabel("material"), "Material");
    assert.equal(contentBinEntityLabel("question"), "MCQ");
    assert.equal(contentBinEntityLabel("prof_session_day"), "Prof. Session day");
  });
});
