import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getR2Config,
  presignR2Object,
  resolvePaymentR2Bucket,
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

const R2_ENV_KEYS = [
  "MEDVERSE_ENV",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PAYMENT_BUCKET",
  "R2_BUCKET",
  "R2_ENDPOINT",
] as const;

const savedEnv: Partial<Record<(typeof R2_ENV_KEYS)[number], string | undefined>> =
  {};

function stashR2Env() {
  for (const key of R2_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreR2Env() {
  for (const key of R2_ENV_KEYS) {
    const prev = savedEnv[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function clearR2Env() {
  for (const key of R2_ENV_KEYS) delete process.env[key];
}

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

describe("production payment R2 bucket separation (F4)", () => {
  afterEach(() => {
    restoreR2Env();
  });

  it("requires R2_PAYMENT_BUCKET in production and never falls back to R2_BUCKET", () => {
    stashR2Env();
    clearR2Env();
    process.env.MEDVERSE_ENV = "production";
    process.env.R2_ACCOUNT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.R2_ACCESS_KEY_ID = "payment-access-key";
    process.env.R2_SECRET_ACCESS_KEY = "payment-secret-key-not-a-real-secret";
    process.env.R2_BUCKET = "medverse-prod-backups";

    assert.equal(resolvePaymentR2Bucket(), "");
    const missing = getR2Config();
    assert.deepEqual(missing, { error: "r2_not_configured" });

    process.env.R2_PAYMENT_BUCKET = "medverse-prod-payment-proofs";
    assert.equal(resolvePaymentR2Bucket(), "medverse-prod-payment-proofs");
    const ok = getR2Config();
    assert.equal("error" in ok, false);
    if ("error" in ok) return;
    assert.equal(ok.bucket, "medverse-prod-payment-proofs");
  });

  it("allows non-production fallback to R2_BUCKET for shared private buckets", () => {
    stashR2Env();
    clearR2Env();
    process.env.MEDVERSE_ENV = "vps-staging";
    process.env.R2_ACCOUNT_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    process.env.R2_ACCESS_KEY_ID = "staging-access-key";
    process.env.R2_SECRET_ACCESS_KEY = "staging-secret-key-not-a-real-secret";
    process.env.R2_BUCKET = "medverse-staging-private";

    assert.equal(resolvePaymentR2Bucket(), "medverse-staging-private");
    const ok = getR2Config();
    assert.equal("error" in ok, false);
    if ("error" in ok) return;
    assert.equal(ok.bucket, "medverse-staging-private");
  });

  it("prefers R2_PAYMENT_BUCKET over R2_BUCKET when both are set", () => {
    stashR2Env();
    clearR2Env();
    process.env.MEDVERSE_ENV = "production";
    process.env.R2_PAYMENT_BUCKET = "medverse-prod-payment-proofs";
    process.env.R2_BUCKET = "medverse-prod-backups";
    assert.equal(resolvePaymentR2Bucket(), "medverse-prod-payment-proofs");
  });
});
