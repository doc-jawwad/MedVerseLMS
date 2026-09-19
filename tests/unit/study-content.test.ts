import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedR2ObjectKey,
  presignR2Object,
  type R2Config,
} from "../../src/lib/r2/presign.ts";
import { renderStudyMarkdown } from "../../src/lib/study/markdown.ts";
import {
  canPublishToStudents,
  entitlementForTestAudience,
  testAudienceFromEntitlement,
} from "../../src/lib/study/test-audience.ts";
import { countdownParts, sortByOpensAtAsc } from "../../src/lib/study/upcoming.ts";
import { orderPearlIds, pearlProgress } from "../../src/lib/study/pearl-order.ts";
import { isStudyPdfFile } from "../../src/lib/study/upload-rules.ts";

const config: R2Config = {
  accountId: "testaccount",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "test-secret-must-not-appear",
  bucket: "medverse-private",
  endpoint: "https://testaccount.r2.cloudflarestorage.com",
  region: "auto",
};

describe("study content helpers", () => {
  it("maps Free / Paid / Neither onto existing entitlement (no second enum)", () => {
    assert.equal(entitlementForTestAudience("free"), "free");
    assert.equal(entitlementForTestAudience("paid"), "any_subscription");
    assert.equal(entitlementForTestAudience("none"), null);
    assert.equal(canPublishToStudents("none"), false);
    assert.equal(canPublishToStudents("free"), true);
    assert.equal(testAudienceFromEntitlement("any_subscription", "published"), "paid");
  });

  it("sorts upcoming tests by opens_at ascending", () => {
    const sorted = sortByOpensAtAsc([
      { id: "b", opens_at: "2026-09-22T10:00:00.000Z" },
      { id: "a", opens_at: "2026-09-20T08:00:00.000Z" },
      { id: "c", opens_at: "2026-09-21T09:00:00.000Z" },
    ]);
    assert.deepEqual(sorted.map((r) => r.id), ["a", "c", "b"]);
  });

  it("shows a countdown before opens_at and Open now afterward", () => {
    const opens = "2026-09-20T12:00:00.000Z";
    const before = countdownParts(opens, Date.parse("2026-09-20T10:00:00.000Z"));
    const after = countdownParts(opens, Date.parse("2026-09-20T12:00:01.000Z"));
    assert.equal(before.ready, false);
    assert.match(before.label, /Opens in/);
    assert.equal(after.ready, true);
    assert.equal(after.label, "Open now");
  });

  it("renders guideline markdown without raw HTML", () => {
    const html = renderStudyMarkdown("# Title\n\n<script>x</script>\n\n- one\n- **two**");
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<strong>two<\/strong>/);
  });

  it("orders pearls sequentially or shuffled without dropping ids", () => {
    const ids = ["a", "b", "c"];
    assert.deepEqual(orderPearlIds(ids, false), ids);
    const shuffled = orderPearlIds(ids, true);
    assert.equal(shuffled.length, 3);
    assert.ok(ids.every((id) => shuffled.includes(id)));
    assert.equal(pearlProgress(0, 3), "1 of 3");
  });

  it("rejects non-PDF uploads", () => {
    assert.equal(isStudyPdfFile({ type: "application/pdf", size: 100 }), null);
    assert.equal(isStudyPdfFile({ type: "text/plain", size: 100 }), "pdf_type_invalid");
  });

  it("signs study-content keys and refuses public or backup keys", () => {
    assert.equal(isAllowedR2ObjectKey("study-content/t/u/obj"), true);
    assert.equal(isAllowedR2ObjectKey("payment-proofs/t/s/obj"), true);
    assert.equal(isAllowedR2ObjectKey("https://r2.example/file.pdf"), false);
    assert.equal(isAllowedR2ObjectKey("backups/dump.sql"), false);

    const signed = presignR2Object({
      method: "GET",
      key: "study-content/t/u/obj",
      expiresSeconds: 300,
      now: new Date("2026-09-19T00:00:00.000Z"),
      config,
    });
    assert.equal("url" in signed, true);
    if (!("url" in signed)) return;
    assert.match(signed.url, /X-Amz-Signature=/);
    assert.doesNotMatch(signed.url, /test-secret-must-not-appear/);

    const denied = presignR2Object({
      method: "GET",
      key: "https://cdn.example/secret.pdf",
      config,
    });
    assert.equal("error" in denied, true);
  });
});
