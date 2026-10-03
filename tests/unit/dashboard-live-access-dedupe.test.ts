import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Dashboard Performance v1 — request-local has_live dedupe contract.
 * Source-structure checks (not runtime RSC); keep patterns resilient to formatting.
 */
describe("dashboard live-subscription dedupe (v1)", () => {
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(student)/dashboard/page.tsx"),
    "utf8"
  );
  const helper = readFileSync(
    path.join(process.cwd(), "src/lib/subscriptions/student-live-access.ts"),
    "utf8"
  );
  const layout = readFileSync(
    path.join(process.cwd(), "src/app/(student)/layout.tsx"),
    "utf8"
  );

  it("does not invoke a second raw has_live_subscription RPC on the page", () => {
    assert.doesNotMatch(page, /\.rpc\(\s*["']has_live_subscription["']/);
  });

  it("uses getStudentHasLiveSubscription as the live-access source inside Promise.all", () => {
    assert.match(page, /getStudentHasLiveSubscription/);
    assert.match(
      page,
      /Promise\.all\(\s*\[[\s\S]*?getStudentHasLiveSubscription\(\)/
    );
    // Helper must remain React.cache + has_live RPC (shared with layout).
    assert.match(helper, /cache\s*\(/);
    assert.match(helper, /has_live_subscription/);
    assert.match(layout, /getStudentHasLiveSubscription/);
  });

  it("feeds the cached value into buildStudentSubscriptionView and paidDetails", () => {
    assert.match(
      page,
      /buildStudentSubscriptionView\(\s*\{[\s\S]*?hasLiveAccess\s*,/
    );
    assert.doesNotMatch(
      page,
      /buildStudentSubscriptionView\(\s*\{[\s\S]*?Boolean\(\s*liveSub\s*\)/
    );
    assert.match(
      page,
      /studentHasPaidLmsSections\(\s*hasLiveAccess\s*\)/
    );
  });

  it("keeps finalizeOwnExpiredAttempts before the main Promise.all fan-out", () => {
    const finalizeIdx = page.search(
      /await\s+finalizeOwnExpiredAttempts\s*\(/
    );
    const fanOutIdx = page.search(/await\s+Promise\.all\s*\(/);
    assert.ok(finalizeIdx >= 0, "finalizeOwnExpiredAttempts await missing");
    assert.ok(fanOutIdx >= 0, "Promise.all fan-out missing");
    assert.ok(
      finalizeIdx < fanOutIdx,
      "finalize must remain before the dashboard Promise.all"
    );
    // No sequential getStudentHasLiveSubscription await before the fan-out.
    const beforeFanOut = page.slice(0, fanOutIdx);
    assert.doesNotMatch(
      beforeFanOut,
      /await\s+getStudentHasLiveSubscription\s*\(/
    );
  });
});
