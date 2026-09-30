import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { progressSubjectIdsFromPracticeBatch } from "../../src/lib/practice/progress-subject-ids.ts";

describe("progressSubjectIdsFromPracticeBatch", () => {
  it("collects unique departmental subject_ids from a practice batch", () => {
    assert.deepEqual(
      progressSubjectIdsFromPracticeBatch([
        { subject_id: "dept-a" },
        { subject_id: "dept-b" },
        { subject_id: "dept-a" },
        { subject_id: null },
        {},
      ]),
      ["dept-a", "dept-b"]
    );
  });

  it("never invents a product-subject fallback", () => {
    assert.deepEqual(progressSubjectIdsFromPracticeBatch([]), []);
    assert.deepEqual(
      progressSubjectIdsFromPracticeBatch([{ subject_id: "" }, { subject_id: "  " }]),
      []
    );
  });
});
