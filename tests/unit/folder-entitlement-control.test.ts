import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderEntitlementIsSubjectLevel } from "../../src/lib/admin/folder-entitlement-control.ts";

describe("admin folder entitlement control", () => {
  it("MCQ Bank folders follow the subject, not a per-folder switch", () => {
    assert.equal(folderEntitlementIsSubjectLevel("mcq_bank"), true);
  });
  it("ordinary material folders keep the Free/Paid control", () => {
    for (const t of ["notes", "syllabus", "one_liner", "lectures", "ospe_lectures", "books"]) {
      assert.equal(folderEntitlementIsSubjectLevel(t), false, t);
    }
  });
});
