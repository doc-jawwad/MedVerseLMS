import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentBinPurgeErrorMessage,
  extractPurgeErrorCode,
} from "../../src/lib/content-bin/purge-errors.ts";
import { summarizePurgeOutcomes } from "../../src/lib/content-bin/purge-batch.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("contentBinPurgeErrorMessage", () => {
  it("maps question_referenced_by_test to a clear retained reason", () => {
    const msg = contentBinPurgeErrorMessage("question_referenced_by_test");
    assert.match(msg, /referenced by a test/i);
    assert.doesNotMatch(msg, /Something went wrong/);
  });

  it("maps mcq_bank_folder_not_empty to a clear live-children reason", () => {
    const msg = contentBinPurgeErrorMessage("mcq_bank_folder_not_empty");
    assert.match(msg, /live subfolders or questions/i);
  });

  it("extracts business codes embedded in PostgREST text", () => {
    assert.equal(
      extractPurgeErrorCode("P0001: question_referenced_by_test"),
      "question_referenced_by_test"
    );
  });

  it("keeps unexpected FK noise as generic", () => {
    assert.equal(
      contentBinPurgeErrorMessage(
        'update or delete on table "mcq_bank_folders" violates foreign key constraint'
      ),
      "Something went wrong. Please try again."
    );
  });

  it("maps permission_denied", () => {
    assert.match(
      contentBinPurgeErrorMessage("permission_denied"),
      /do not have permission/i
    );
  });
});

describe("content bin mcq folder purge migration", () => {
  const mig = readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20261005050000_content_bin_mcq_folder_purge_fix.sql"
    ),
    "utf8"
  );

  it("introduces purge_mcq_bank_folder_content and refuses live children", () => {
    assert.match(mig, /purge_mcq_bank_folder_content/);
    assert.match(mig, /mcq_bank_folder_not_empty/);
    assert.match(
      mig,
      /delete from public\.mcq_bank_subfolders[\s\S]*folder_id = p_entity_id/
    );
  });

  it("adds mcq_bank_subfolder to purge_content_batch", () => {
    assert.match(mig, /'mcq_bank_subfolder'/);
  });
});

describe("summarizePurgeOutcomes folder blocks", () => {
  it("surfaces live-children blocked count separately", () => {
    const r = summarizePurgeOutcomes(
      [
        {
          entityType: "mcq_bank_folder",
          entityId: "a",
          outcome: "blocked",
          detail: "mcq_bank_folder_not_empty",
        },
        {
          entityType: "question",
          entityId: "b",
          outcome: "blocked",
          detail: "question_referenced_by_test",
        },
      ],
      1
    );
    assert.match(r.message, /1 blocked \(still has live children\)/);
    assert.match(r.message, /1 retained because referenced by test/);
  });
});
