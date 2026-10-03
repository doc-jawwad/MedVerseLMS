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
import { mcqBankFolderContentSummary } from "../../src/lib/admin/mcq-bank-folder-ui.ts";

describe("mcq_bank_folder practice scope", () => {
  it("includes mcq_bank_folder in PRACTICE_SCOPE_TYPES", () => {
    assert.ok(PRACTICE_SCOPE_TYPES.includes("mcq_bank_folder"));
    assert.equal(isPracticeScopeType("mcq_bank_folder"), true);
    assert.equal(isPracticeScopeType("other"), false);
  });

  it("includes mcq_bank_subfolder scopes", () => {
    assert.ok(PRACTICE_SCOPE_TYPES.includes("mcq_bank_subfolder"));
    assert.ok(PRACTICE_SCOPE_TYPES.includes("mcq_bank_subfolder_favorites"));
    assert.ok(PRACTICE_SCOPE_TYPES.includes("mcq_bank_subfolder_incorrect"));
    assert.equal(isPracticeScopeType("mcq_bank_subfolder"), true);
  });

  it("maps folder-not-found to a student message", () => {
    assert.match(
      practiceBatchAccessMessage("mcq_bank_folder_not_found"),
      /folder/i
    );
  });

  it("maps subfolder-not-found to a student message", () => {
    assert.match(
      practiceBatchAccessMessage("mcq_bank_subfolder_not_found"),
      /subfolder/i
    );
  });
});

describe("content bin mcq_bank_folder label", () => {
  it("labels mcq_bank_folder entity", () => {
    const t: ContentBinEntityType = "mcq_bank_folder";
    assert.ok(contentBinEntityLabel(t).length > 0);
  });

  it("labels mcq_bank_subfolder entity", () => {
    const t: ContentBinEntityType = "mcq_bank_subfolder";
    assert.equal(contentBinEntityLabel(t), "MCQ Bank subfolder");
  });
});

describe("mcq bank folder content summary", () => {
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
    assert.equal(
      mcqBankFolderContentSummary({
        question_count: 4,
        pdf_count: 1,
        subfolder_count: 2,
      }),
      "4 questions · 2 subfolders · 1 PDF"
    );
  });

  it("documents Main Admin cascade delete is not gated on empty folder UI helpers", () => {
    // Delete authorization + cascade live in admin_soft_delete_mcq_bank_folder
    // (is_main_admin). UI shows content summary only; non-empty folders are deletable.
    const nonEmpty = mcqBankFolderContentSummary({
      question_count: 5,
      pdf_count: 1,
      subfolder_count: 2,
    });
    assert.match(nonEmpty, /5 questions/);
    assert.match(nonEmpty, /2 subfolders/);
  });
});
