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
import {
  isMcqBankFolderEmptyForDelete,
  mcqBankFolderContentSummary,
  mcqBankFolderDeleteBlockedReason,
} from "../../src/lib/admin/mcq-bank-folder-ui.ts";

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

describe("mcq bank folder delete UI contract", () => {
  it("allows delete only when questions and PDFs are both zero", () => {
    assert.equal(
      isMcqBankFolderEmptyForDelete({ question_count: 0, pdf_count: 0 }),
      true
    );
    assert.equal(
      isMcqBankFolderEmptyForDelete({ question_count: 2, pdf_count: 0 }),
      false
    );
    assert.equal(
      isMcqBankFolderEmptyForDelete({ question_count: 0, pdf_count: 1 }),
      false
    );
    assert.equal(
      isMcqBankFolderEmptyForDelete({ question_count: 3, pdf_count: 2 }),
      false
    );
  });

  it("summarizes counts for questions-only, PDFs-only, both, and empty", () => {
    assert.equal(
      mcqBankFolderContentSummary({ question_count: 1, pdf_count: 0 }),
      "1 question · 0 PDFs"
    );
    assert.equal(
      mcqBankFolderContentSummary({ question_count: 0, pdf_count: 1 }),
      "0 questions · 1 PDF"
    );
    assert.equal(
      mcqBankFolderContentSummary({ question_count: 2, pdf_count: 3 }),
      "2 questions · 3 PDFs"
    );
    assert.equal(
      mcqBankFolderContentSummary({ question_count: 0, pdf_count: 0 }),
      "0 questions · 0 PDFs"
    );
  });

  it("explains delete block for questions-only, PDFs-only, and both", () => {
    assert.equal(
      mcqBankFolderDeleteBlockedReason({ question_count: 0, pdf_count: 0 }),
      null
    );
    assert.equal(
      mcqBankFolderDeleteBlockedReason({ question_count: 2, pdf_count: 0 }),
      "Remove 2 questions first."
    );
    assert.equal(
      mcqBankFolderDeleteBlockedReason({ question_count: 0, pdf_count: 1 }),
      "Remove 1 PDF first."
    );
    assert.equal(
      mcqBankFolderDeleteBlockedReason({ question_count: 1, pdf_count: 2 }),
      "Remove 1 question and 2 PDFs first."
    );
  });
});
