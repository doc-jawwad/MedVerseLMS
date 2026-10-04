import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  importedSetSelectableIds,
  mergeSelectionWithImportedSet,
  partitionImportedAdd,
  uniqueQuestionIds,
} from "../../src/lib/tests/import-batch-selection.ts";

describe("import-batch-selection", () => {
  it("uniqueQuestionIds preserves order and drops null/dupes", () => {
    assert.deepEqual(
      uniqueQuestionIds(["a", null, "b", "a", undefined, "c"]),
      ["a", "b", "c"]
    );
  });

  it("imported set count excludes already-on-test and outside-pool ids", () => {
    const imported = ["q1", "q2", "q3", "q4"];
    const selectable = importedSetSelectableIds({
      importedIds: imported,
      alreadyOnTest: ["q2"],
      poolIds: ["q1", "q2", "q3", "other"],
    });
    assert.deepEqual(selectable, ["q1", "q3"]);
    assert.equal(selectable.length, 2);
  });

  it("imported set without pool scope returns all not-on-test ids", () => {
    assert.deepEqual(
      importedSetSelectableIds({
        importedIds: ["a", "b", "c"],
        alreadyOnTest: ["b"],
      }),
      ["a", "c"]
    );
  });

  it("selecting the set merges into manual ticks without duplicates", () => {
    assert.deepEqual(
      mergeSelectionWithImportedSet(["manual", "a"], ["a", "b", "c"]),
      ["manual", "a", "b", "c"]
    );
  });

  it("questions outside the imported set are not included when selecting the set", () => {
    const pool = ["imp1", "imp2", "other1", "other2"];
    const imported = ["imp1", "imp2"];
    const selected = mergeSelectionWithImportedSet(
      [],
      importedSetSelectableIds({
        importedIds: imported,
        alreadyOnTest: [],
        poolIds: pool,
      })
    );
    assert.deepEqual(selected, ["imp1", "imp2"]);
    assert.ok(!selected.includes("other1"));
    assert.ok(!selected.includes("other2"));
  });

  it("partitionImportedAdd is idempotent for repeated selection", () => {
    const first = partitionImportedAdd({
      importedIds: ["q1", "q2", "q3"],
      alreadyOnTest: [],
    });
    assert.deepEqual(first.toAdd, ["q1", "q2", "q3"]);
    assert.deepEqual(first.alreadyPresent, []);

    const second = partitionImportedAdd({
      importedIds: ["q1", "q2", "q3"],
      alreadyOnTest: ["q1", "q2", "q3"],
    });
    assert.deepEqual(second.toAdd, []);
    assert.deepEqual(second.alreadyPresent, ["q1", "q2", "q3"]);
  });

  it("keeps version/id identity as opaque string ids (no rewriting)", () => {
    const ids = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ];
    const selectable = importedSetSelectableIds({
      importedIds: ids,
      alreadyOnTest: [],
    });
    assert.deepEqual(selectable, ids);
  });
});
