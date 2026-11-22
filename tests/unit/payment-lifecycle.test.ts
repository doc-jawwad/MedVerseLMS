import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivatePaymentScreenshotKey } from "../../src/lib/payments/application.ts";
import {
  deleteR2Object,
  presignR2Object,
  putR2Object,
  type R2Config,
} from "../../src/lib/r2/presign.ts";

const config: R2Config = {
  accountId: "testaccount",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "test-secret-must-not-appear",
  bucket: "medverse-private",
  endpoint: "https://testaccount.r2.cloudflarestorage.com",
  region: "auto",
};

const studentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const key = `payment-proofs/00000000-0000-0000-0000-000000000001/${studentId}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;

describe("payment proof ownership checks (F5)", () => {
  it("requires the student id segment for owned-key checks", () => {
    assert.equal(isPrivatePaymentScreenshotKey(key, studentId), true);
    assert.equal(
      isPrivatePaymentScreenshotKey(key, "cccccccc-cccc-cccc-cccc-cccccccccccc"),
      false
    );
    assert.equal(isPrivatePaymentScreenshotKey("https://evil/proof.png", studentId), false);
  });
});

describe("deleteR2Object signing (F5)", () => {
  it("signs DELETE for payment-proofs keys and never embeds the secret", () => {
    const signed = presignR2Object({
      method: "DELETE",
      key,
      expiresSeconds: 300,
      now: new Date("2026-09-15T00:00:00.000Z"),
      config,
    });
    assert.equal("url" in signed, true);
    if (!("url" in signed)) return;
    assert.match(signed.url, /X-Amz-Signature=/);
    assert.doesNotMatch(signed.url, /test-secret-must-not-appear/);
  });

  it("treats HTTP 404 as successful delete", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof fetch;
    try {
      const result = await deleteR2Object({ key, config });
      assert.deepEqual(result, {});
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses to delete non-prefix keys", async () => {
    const result = await deleteR2Object({
      key: "backups/dump.sql",
      config,
    });
    assert.equal(result.error, "invalid_object_key");
  });
});

describe("putR2Object (payment proof upload)", () => {
  it("sends Content-Type on PUT and returns success on 200", async () => {
    const originalFetch = globalThis.fetch;
    let sawContentType: string | null = null;
    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      sawContentType = headers.get("Content-Type");
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const result = await putR2Object({
        key,
        body: Buffer.from("webp-bytes"),
        contentType: "image/webp",
        config,
      });
      assert.deepEqual(result, {});
      assert.equal(sawContentType, "image/webp");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps thrown fetch failures to r2_upload_failed instead of throwing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      const result = await putR2Object({
        key,
        body: Buffer.from("webp-bytes"),
        contentType: "image/webp",
        config,
      });
      assert.equal(result.error, "r2_upload_failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps non-OK HTTP status to r2_upload_failed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 403 })) as typeof fetch;
    try {
      const result = await putR2Object({
        key,
        body: Buffer.from("webp-bytes"),
        contentType: "image/webp",
        config,
      });
      assert.equal(result.error, "r2_upload_failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
