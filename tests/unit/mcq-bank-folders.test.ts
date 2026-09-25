import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPracticeScopeType,
  PRACTICE_SCOPE_TYPES,
} from "../../src/lib/practice/types.ts";
import { practiceBatchAccessMessage } from "../../src/lib/practice/scope.ts";
import {
  contentBinEntityLabel,
  type ContentBinEntityType,
} from "../../src/lib/content-bin/labels.ts";

describe("mcq_bank_folder practice scope", () => {
  it("includes mcq_bank_folder in PRACTICE_SCOPE_TYPES", () => {
    assert.ok(PRACTICE_SCOPE_TYPES.includes("mcq_bank_folder"));
    assert.equal(isPracticeScopeType("mcq_bank_folder"), true);
    assert.equal(isPracticeScopeType("other"), false);
  });

  it("maps folder-not-found to a student message", () => {
    assert.match(
      practiceBatchAccessMessage("mcq_bank_folder_not_found"),
      /folder/i
    );
  });
});

describe("content bin mcq_bank_folder label", () => {
  it("labels mcq_bank_folder entity", () => {
    const t: ContentBinEntityType = "mcq_bank_folder";
    assert.ok(contentBinEntityLabel(t).length > 0);
  });
});
