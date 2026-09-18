import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNotCloudProduction,
  looksLikeCloudSupabase,
} from "../../scripts/lib/env-guard.mjs";

describe("assertNotCloudProduction", () => {
  it("throws on the production Cloud ref without an allow flag", () => {
    delete process.env.MEDVERSE_ALLOW_PRODUCTION;
    assert.throws(
      () => assertNotCloudProduction("https://pxoxijlhcvbrostrquft.supabase.co"),
      /production/
    );
  });

  it("throws on the staging Cloud ref without an allow flag", () => {
    delete process.env.MEDVERSE_ALLOW_CLOUD_STAGING;
    assert.throws(
      () => assertNotCloudProduction("postgresql://user@db.vygtwrsshcyfahfzurgq.supabase.co/postgres"),
      /staging/
    );
  });

  it("allows loopback URLs", () => {
    assert.doesNotThrow(() =>
      assertNotCloudProduction("postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    );
  });

  it("looksLikeCloudSupabase is false for localhost", () => {
    assert.equal(looksLikeCloudSupabase("127.0.0.1"), false);
  });
});
