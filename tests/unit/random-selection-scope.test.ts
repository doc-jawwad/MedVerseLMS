import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  importBatchYieldsEmptyPool,
  pickRandomQuestionIds,
  questionMatchesMcqBankScope,
  resolveMcqBankScope,
  stemSearchPattern,
} from "../../src/lib/tests/random-selection-scope.ts";

const YEAR = "year-1";
const YEAR2 = "year-2";
const BANK_SURGERY = "bank-surgery";
const BANK_MED = "bank-med";
const FOLDER_A = "folder-a";
const FOLDER_B = "folder-b";
const FOLDER_OTHER_BANK = "folder-med";
const FOLDER_Y2 = "folder-y2";
const SUB_A1 = "sub-a1";
const SUB_A2 = "sub-a2";
const SUB_B1 = "sub-b1";

const folders = [
  {
    id: FOLDER_A,
    year_id: YEAR,
    academic_product_subject_id: BANK_SURGERY,
  },
  {
    id: FOLDER_B,
    year_id: YEAR,
    academic_product_subject_id: BANK_SURGERY,
  },
  {
    id: FOLDER_OTHER_BANK,
    year_id: YEAR,
    academic_product_subject_id: BANK_MED,
  },
  {
    id: FOLDER_Y2,
    year_id: YEAR2,
    academic_product_subject_id: BANK_SURGERY,
  },
];

const subfolders = [
  { id: SUB_A1, folder_id: FOLDER_A },
  { id: SUB_A2, folder_id: FOLDER_A },
  { id: SUB_B1, folder_id: FOLDER_B },
];

describe("resolveMcqBankScope", () => {
  it("returns none when no bank/folder/subfolder selected", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: {},
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "none" }
    );
  });

  it("scopes bank to only that product's folders in the test year", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: { mcq_bank_product_subject_id: BANK_SURGERY },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "bank_folders", folderIds: [FOLDER_A, FOLDER_B] }
    );
  });

  it("scopes folder exactly (excludes sibling folders)", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: {
          mcq_bank_product_subject_id: BANK_SURGERY,
          mcq_bank_folder_id: FOLDER_A,
        },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "folder", folderId: FOLDER_A }
    );
  });

  it("scopes subfolder exactly (excludes sibling subfolders)", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: {
          mcq_bank_product_subject_id: BANK_SURGERY,
          mcq_bank_folder_id: FOLDER_A,
          mcq_bank_subfolder_id: SUB_A1,
        },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "subfolder", subfolderId: SUB_A1 }
    );
  });

  it("rejects cross-year folder instead of broadening", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: { mcq_bank_folder_id: FOLDER_Y2 },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "invalid", reason: "folder_year_mismatch" }
    );
  });

  it("rejects bank/folder mismatch instead of broadening", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: {
          mcq_bank_product_subject_id: BANK_MED,
          mcq_bank_folder_id: FOLDER_A,
        },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "invalid", reason: "folder_bank_mismatch" }
    );
  });

  it("rejects subfolder under wrong folder instead of broadening", () => {
    assert.deepEqual(
      resolveMcqBankScope({
        filter: {
          mcq_bank_folder_id: FOLDER_B,
          mcq_bank_subfolder_id: SUB_A1,
        },
        testYearId: YEAR,
        folders,
        subfolders,
      }),
      { kind: "invalid", reason: "subfolder_folder_mismatch" }
    );
  });
});

describe("questionMatchesMcqBankScope", () => {
  const qA1 = {
    mcq_bank_folder_id: FOLDER_A,
    mcq_bank_subfolder_id: SUB_A1,
  };
  const qA2 = {
    mcq_bank_folder_id: FOLDER_A,
    mcq_bank_subfolder_id: SUB_A2,
  };
  const qB1 = {
    mcq_bank_folder_id: FOLDER_B,
    mcq_bank_subfolder_id: SUB_B1,
  };
  const qMed = {
    mcq_bank_folder_id: FOLDER_OTHER_BANK,
    mcq_bank_subfolder_id: "sub-med",
  };
  const qLoose = {
    mcq_bank_folder_id: null,
    mcq_bank_subfolder_id: null,
  };

  it("folder scope includes only that folder", () => {
    const scope = { kind: "folder" as const, folderId: FOLDER_A };
    assert.equal(questionMatchesMcqBankScope(qA1, scope), true);
    assert.equal(questionMatchesMcqBankScope(qA2, scope), true);
    assert.equal(questionMatchesMcqBankScope(qB1, scope), false);
    assert.equal(questionMatchesMcqBankScope(qMed, scope), false);
    assert.equal(questionMatchesMcqBankScope(qLoose, scope), false);
  });

  it("subfolder scope excludes sibling subfolders and other folders", () => {
    const scope = { kind: "subfolder" as const, subfolderId: SUB_A1 };
    assert.equal(questionMatchesMcqBankScope(qA1, scope), true);
    assert.equal(questionMatchesMcqBankScope(qA2, scope), false);
    assert.equal(questionMatchesMcqBankScope(qB1, scope), false);
  });

  it("bank scope excludes other products", () => {
    const scope = {
      kind: "bank_folders" as const,
      folderIds: [FOLDER_A, FOLDER_B],
    };
    assert.equal(questionMatchesMcqBankScope(qA1, scope), true);
    assert.equal(questionMatchesMcqBankScope(qB1, scope), true);
    assert.equal(questionMatchesMcqBankScope(qMed, scope), false);
    assert.equal(questionMatchesMcqBankScope(qLoose, scope), false);
  });
});

describe("pickRandomQuestionIds", () => {
  it("respects requested count when enough eligible exist", () => {
    const picked = pickRandomQuestionIds({
      candidateIds: ["a", "b", "c", "d", "e"],
      excludedIds: [],
      n: 3,
      random: () => 0,
    });
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
  });

  it("returns fewer when pool is short (existing product rule)", () => {
    const picked = pickRandomQuestionIds({
      candidateIds: ["a", "b"],
      excludedIds: [],
      n: 10,
    });
    assert.equal(picked.length, 2);
    assert.deepEqual([...picked].sort(), ["a", "b"]);
  });

  it("excludes already-on-test ids and never duplicates", () => {
    const picked = pickRandomQuestionIds({
      candidateIds: ["a", "b", "a", "c"],
      excludedIds: ["b"],
      n: 10,
      random: () => 0,
    });
    assert.equal(picked.includes("b"), false);
    assert.equal(new Set(picked).size, picked.length);
    assert.deepEqual([...picked].sort(), ["a", "c"]);
  });

  it("returns empty when n is 0 or all excluded", () => {
    assert.deepEqual(
      pickRandomQuestionIds({
        candidateIds: ["a"],
        excludedIds: [],
        n: 0,
      }),
      []
    );
    assert.deepEqual(
      pickRandomQuestionIds({
        candidateIds: ["a"],
        excludedIds: ["a"],
        n: 5,
      }),
      []
    );
  });
});

describe("random-add shares the visible pool's text/import filters", () => {
  it("stemSearchPattern trims, lowercases, and ignores blank input", () => {
    assert.equal(stemSearchPattern("  Femoral Nerve "), "%femoral nerve%");
    assert.equal(stemSearchPattern("   "), null);
    assert.equal(stemSearchPattern(undefined), null);
  });

  it("admin page and addRandomQuestions both apply q and import batch", () => {
    const root = new URL("../../", import.meta.url);
    const page = readFileSync(
      new URL("src/app/(admin)/admin/tests/[id]/page.tsx", root),
      "utf8"
    );
    const action = readFileSync(
      new URL("src/lib/actions/tests.ts", root),
      "utf8"
    );
    // Page hands q + import batch to AddRandomButton's filter.
    assert.match(page, /q: filters\.q,\s*\n\s*import_batch_id: importBatchId/);
    assert.match(page, /stemSearchPattern\(filters\.q\)/);
    // Action applies both, via the same pattern helper and import_rows.
    const body = action.slice(action.indexOf("export async function addRandomQuestions"));
    assert.match(body, /stemSearchPattern\(filter\.q\)/);
    assert.match(body, /ilike\("stem_normalized"/);
    assert.match(body, /from\("import_rows"\)/);
    assert.match(body, /\.in\("id", importedIds\)/);
    assert.match(body, /importBatchYieldsEmptyPool\(true, importedIds\)\) return \{ added: 0 \}/);
  });

  it("empty/unknown import batch yields an empty pool, not the full pool", () => {
    assert.equal(importBatchYieldsEmptyPool(true, []), true);
    assert.equal(importBatchYieldsEmptyPool(true, null), true);
    assert.equal(importBatchYieldsEmptyPool(true, undefined), true);
    assert.equal(importBatchYieldsEmptyPool(true, ["q1"]), false);
    // No batch requested: full pool is unaffected.
    assert.equal(importBatchYieldsEmptyPool(false, []), false);
    assert.equal(importBatchYieldsEmptyPool(false, undefined), false);

    const page = readFileSync(
      new URL("../../src/app/(admin)/admin/tests/[id]/page.tsx", import.meta.url),
      "utf8"
    );
    assert.match(
      page,
      /skipMcqPool =\s*importBatchYieldsEmptyPool\(\s*Boolean\(importBatchId\),\s*importedSet\?\.questionIds/
    );
  });
});
