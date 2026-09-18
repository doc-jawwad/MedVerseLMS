import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { presignR2Object, type R2Config } from "../../src/lib/r2/presign.ts";

const config: R2Config = {
  accountId: "testaccount",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "test-secret-must-not-appear",
  bucket: "medverse-private",
  endpoint: "https://testaccount.r2.cloudflarestorage.com",
  region: "auto",
};

describe("signed-access authorization logic", () => {
  it("refuses to sign a public URL or non-prefix key", () => {
    const publicUrl = presignR2Object({
      method: "GET",
      key: "https://cdn.example/proof.png",
      config,
    });
    assert.equal("error" in publicUrl, true);
    const otherPrefix = presignR2Object({
      method: "GET",
      key: "backups/dump.sql",
      config,
    });
    assert.equal("error" in otherPrefix, true);
  });

  it("signs only payment-proofs keys and never embeds the secret", () => {
    const key =
      "payment-proofs/00000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const signed = presignR2Object({
      method: "GET",
      key,
      expiresSeconds: 300,
      now: new Date("2026-09-15T00:00:00.000Z"),
      config,
    });
    assert.equal("url" in signed, true);
    if (!("url" in signed)) return;
    assert.match(signed.url, /X-Amz-Signature=/);
    assert.match(signed.url, /X-Amz-Expires=300/);
    assert.doesNotMatch(signed.url, /test-secret-must-not-appear/);
    assert.match(signed.url, /payment-proofs/);
    assert.equal(signed.url.includes("https://"), true);
  });
});
