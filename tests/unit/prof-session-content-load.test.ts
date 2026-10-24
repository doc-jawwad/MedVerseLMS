import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mapRpcTree } from "../../src/lib/academic-tree/map-rpc-tree.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Issue 8 Prof. Session content load", () => {
  it("maps day chrome from slots only (ignores unused aggregate fields)", () => {
    const dayId = "11111111-1111-4111-8111-111111111111";
    const subjectId = "22222222-2222-4222-8222-222222222222";
    const mapped = mapRpcTree(
      {
        surface: "library",
        year_id: "33333333-3333-4333-8333-333333333333",
        year_number: 1,
        year_name: "1st Year MBBS",
        subjects: [],
        prof_session: {
          locked: false,
          subjects: [
            {
              subject_id: subjectId,
              name: "Block 1",
              product_key: "block-1",
              folders: [],
              days: [
                {
                  day_id: dayId,
                  name: "Day 1",
                  sort_order: 0,
                  practice_count: 99,
                  test_count: 3,
                  one_liner_count: 12,
                  has_guidelines: true,
                  has_los: false,
                  slots: [
                    { slot_key: "guidelines", name: "Guidelines" },
                    { slot_key: "los", name: "LoS" },
                    { slot_key: "practice_mcqs", name: "Practice MCQs" },
                    { slot_key: "test_mcq", name: "Test MCQs" },
                    { slot_key: "one_liners", name: "One-Liners" },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        surface: "library",
        year_id: "33333333-3333-4333-8333-333333333333",
        year_number: 1,
        year_name: "1st Year MBBS",
        has_live_subscription: true,
      }
    );

    assert.ok(mapped);
    const day = mapped!.prof_session.subjects[0]?.days[0];
    assert.ok(day);
    assert.equal(day!.id, dayId);
    assert.equal(day!.name, "Day 1");
    assert.deepEqual(
      day!.children.map((c) => c.day_slot),
      ["guidelines", "los", "practice_mcqs", "test_mcq", "one_liners"]
    );
  });

  it("maps days that omit aggregate fields (post Issue 8 RPC shape)", () => {
    const dayId = "44444444-4444-4444-8444-444444444444";
    const mapped = mapRpcTree(
      {
        surface: "library",
        year_id: "33333333-3333-4333-8333-333333333333",
        year_number: 1,
        year_name: "1st Year MBBS",
        subjects: [],
        prof_session: {
          locked: false,
          subjects: [
            {
              subject_id: "22222222-2222-4222-8222-222222222222",
              name: "Block 1",
              product_key: "block-1",
              folders: [],
              days: [
                {
                  day_id: dayId,
                  name: "Slim Day",
                  sort_order: 1,
                  slots: [{ slot_key: "one_liners", name: "One-Liners" }],
                },
              ],
            },
          ],
        },
      },
      {
        surface: "library",
        year_id: "33333333-3333-4333-8333-333333333333",
        year_number: 1,
        year_name: "1st Year MBBS",
        has_live_subscription: true,
      }
    );

    assert.equal(mapped?.prof_session.subjects[0]?.days[0]?.id, dayId);
    assert.equal(
      mapped?.prof_session.subjects[0]?.days[0]?.children[0]?.day_slot,
      "one_liners"
    );
  });

  it("scopes MaterialLibraryPage subjects query when subjectId is set", () => {
    const src = readFileSync(
      path.join(root, "src/components/library/material-library-page.tsx"),
      "utf8"
    );
    assert.match(src, /subjectId\s*\n?\s*\?\s*supabase\.from\("subjects"\)/);
    assert.match(src, /\.eq\("id", subjectId\)/);
  });

  it("ships scoped accessible_folder_ids_among migration", () => {
    const sql = readFileSync(
      path.join(
        root,
        "supabase/migrations/20261024180000_prof_session_content_load_perf.sql"
      ),
      "utf8"
    );
    assert.match(sql, /create or replace function public\.accessible_folder_ids_among/);
    assert.match(sql, /f\.id = any \(p_folder_ids\)/);
    assert.doesNotMatch(
      sql,
      /from public\.accessible_folder_ids\(\) af\s+where p_folder_ids/
    );
    assert.match(sql, /create or replace function public\.get_academic_tree/);
    assert.doesNotMatch(sql, /'practice_count'/);
    assert.doesNotMatch(sql, /'one_liner_count'/);
  });
});
