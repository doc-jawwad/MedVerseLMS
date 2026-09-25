import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTENT_BIN_PAGE_SIZE,
  CONTENT_BIN_PURGE_BATCH_SIZE,
  summarizePurgeOutcomes,
  type ContentBinPurgeOutcome,
} from "../../src/lib/content-bin/purge-batch.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("content bin batch purge helpers", () => {
  it("exposes bounded page and batch sizes", () => {
    assert.equal(CONTENT_BIN_PAGE_SIZE, 50);
    assert.equal(CONTENT_BIN_PURGE_BATCH_SIZE, 500);
  });

  it("summarizes purged + blocked + already_gone", () => {
    const outcomes: ContentBinPurgeOutcome[] = [
      { entityType: "question", entityId: "a", outcome: "purged", detail: null },
      { entityType: "question", entityId: "b", outcome: "blocked", detail: "question_referenced_by_test" },
      { entityType: "question", entityId: "c", outcome: "already_gone", detail: "entity_not_found" },
      { entityType: "question", entityId: "d", outcome: "purged", detail: null },
    ];
    const r = summarizePurgeOutcomes(outcomes, 1);
    assert.equal(r.purged, 2);
    assert.equal(r.blocked, 1);
    assert.equal(r.alreadyGone, 1);
    assert.equal(r.failed, 0);
    assert.equal(r.rpcCalls, 1);
    assert.match(r.message, /Purged 2/);
    assert.match(r.message, /1 blocked/);
    assert.match(r.message, /1 already gone/);
  });

  it("treats retry already_gone as non-failure", () => {
    const outcomes: ContentBinPurgeOutcome[] = [
      { entityType: "question", entityId: "a", outcome: "already_gone", detail: "entity_not_found" },
      { entityType: "question", entityId: "b", outcome: "already_gone", detail: "not_in_bin" },
    ];
    const r = summarizePurgeOutcomes(outcomes, 1);
    assert.equal(r.purged, 0);
    assert.equal(r.blocked, 0);
    assert.equal(r.alreadyGone, 2);
    assert.equal(r.failed, 0);
  });

  it("counts unknown outcomes as failed", () => {
    const r = summarizePurgeOutcomes(
      [{ entityType: "question", entityId: "x", outcome: "error", detail: "boom" }],
      1
    );
    assert.equal(r.failed, 1);
    assert.match(r.message, /1 failed/);
  });
});

describe("content bin pagination math", () => {
  it("pages 3500 items at size 50", () => {
    const total = 3500;
    const pages = Math.ceil(total / CONTENT_BIN_PAGE_SIZE);
    assert.equal(pages, 70);
    const lastOffset = (pages - 1) * CONTENT_BIN_PAGE_SIZE;
    assert.equal(lastOffset, 3450);
    assert.equal(total - lastOffset, 50);
  });

  it("chunks 3500 purge into 7 RPC batches of 500", () => {
    const n = 3500;
    const calls = Math.ceil(n / CONTENT_BIN_PURGE_BATCH_SIZE);
    assert.equal(calls, 7);
  });
});

describe("content bin question purge integrity migration", () => {
  const mig = readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20260925160000_content_bin_question_purge_integrity.sql"
    ),
    "utf8"
  );

  it("gates version DELETE via LOCAL GUC, not session_replication_role", () => {
    assert.match(mig, /medverse\.allow_question_version_purge/);
    assert.match(mig, /forbid_version_mutation/);
    // Executable body must not use replica role (comment may mention the old bug).
    const withoutComments = mig.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(withoutComments, /session_replication_role/);
    assert.match(withoutComments, /set_config\('medverse\.allow_question_version_purge'/);
  });

  it("clears practice_answers before question cascade delete", () => {
    assert.match(mig, /delete from public\.practice_answers/);
    assert.match(mig, /delete from public\.questions/);
  });
});
