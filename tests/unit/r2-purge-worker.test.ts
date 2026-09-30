import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeStudyPurgeKey,
  processR2PurgeBatch,
  type R2PurgeDeps,
  type R2PurgeQueueRow,
} from "../../src/lib/r2/purge-worker.ts";

function row(partial: Partial<R2PurgeQueueRow> & { id: string; object_key: string }): R2PurgeQueueRow {
  return {
    entity_type: "material",
    entity_id: null,
    attempts: 1,
    last_error: null,
    completed_at: null,
    ...partial,
  };
}

describe("assertSafeStudyPurgeKey", () => {
  it("allows study-content keys", () => {
    assert.equal(
      assertSafeStudyPurgeKey("study-content/t/u/obj"),
      null
    );
  });

  it("rejects payment proofs and backups", () => {
    assert.equal(
      assertSafeStudyPurgeKey("payment-proofs/t/s/x"),
      "not_study_content_prefix"
    );
    assert.equal(
      assertSafeStudyPurgeKey("medverse/vps-staging/x.dump.enc"),
      "backup_prefix_forbidden"
    );
  });
});

describe("processR2PurgeBatch", () => {
  it("deletes unreferenced claimed keys and completes", async () => {
    const completed: Array<{ id: string; error: string | null | undefined }> = [];
    const deleted: string[] = [];
    const deps: R2PurgeDeps = {
      claimBatch: async () => [
        row({
          id: "11111111-1111-1111-1111-111111111111",
          object_key: "study-content/a/b/c",
        }),
      ],
      complete: async (id, error) => {
        completed.push({ id, error });
      },
      isObjectKeyStillReferenced: async () => false,
      deleteObject: async (key) => {
        deleted.push(key);
        return {};
      },
    };
    const result = await processR2PurgeBatch(deps, { limit: 10 });
    assert.equal(result.claimed, 1);
    assert.equal(result.deleted, 1);
    assert.deepEqual(deleted, ["study-content/a/b/c"]);
    assert.deepEqual(completed, [
      { id: "11111111-1111-1111-1111-111111111111", error: null },
    ]);
  });

  it("skips delete when still referenced", async () => {
    const deleted: string[] = [];
    const deps: R2PurgeDeps = {
      claimBatch: async () => [
        row({
          id: "22222222-2222-2222-2222-222222222222",
          object_key: "study-content/a/b/shared",
        }),
      ],
      complete: async () => {},
      isObjectKeyStillReferenced: async () => true,
      deleteObject: async (key) => {
        deleted.push(key);
        return {};
      },
    };
    const result = await processR2PurgeBatch(deps);
    assert.equal(result.skipped, 1);
    assert.equal(result.deleted, 0);
    assert.deepEqual(deleted, []);
  });

  it("records delete failures without completing as success", async () => {
    const completed: Array<{ id: string; error: string | null | undefined }> = [];
    const deps: R2PurgeDeps = {
      claimBatch: async () => [
        row({
          id: "33333333-3333-3333-3333-333333333333",
          object_key: "study-content/a/b/fail",
        }),
      ],
      complete: async (id, error) => {
        completed.push({ id, error });
      },
      isObjectKeyStillReferenced: async () => false,
      deleteObject: async () => ({ error: "r2_delete_failed" }),
    };
    const result = await processR2PurgeBatch(deps);
    assert.equal(result.failed, 1);
    assert.equal(completed[0]?.error, "r2_delete_failed");
  });

  it("does not delete invalid keys", async () => {
    const deleted: string[] = [];
    const deps: R2PurgeDeps = {
      claimBatch: async () => [
        row({
          id: "44444444-4444-4444-4444-444444444444",
          object_key: "payment-proofs/x",
        }),
      ],
      complete: async () => {},
      isObjectKeyStillReferenced: async () => false,
      deleteObject: async (key) => {
        deleted.push(key);
        return {};
      },
    };
    const result = await processR2PurgeBatch(deps);
    assert.equal(result.failed, 1);
    assert.deepEqual(deleted, []);
  });
});
