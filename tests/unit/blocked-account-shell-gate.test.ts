import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLiveExamAttemptPath } from "../../src/lib/auth/live-exam-path.ts";

describe("isLiveExamAttemptPath", () => {
  it("allows only the exam player path", () => {
    assert.equal(isLiveExamAttemptPath("/tests/abc/attempt"), true);
    assert.equal(isLiveExamAttemptPath("/tests/abc/attempt/"), true);
  });

  it("rejects student shell and other exam-adjacent routes", () => {
    assert.equal(isLiveExamAttemptPath("/dashboard"), false);
    assert.equal(isLiveExamAttemptPath("/subscription"), false);
    assert.equal(isLiveExamAttemptPath("/tests"), false);
    assert.equal(isLiveExamAttemptPath("/tests/abc"), false);
    assert.equal(isLiveExamAttemptPath("/tests/abc/result"), false);
    assert.equal(isLiveExamAttemptPath("/pending?state=restricted"), false);
    assert.equal(isLiveExamAttemptPath(null), false);
    assert.equal(isLiveExamAttemptPath(""), false);
  });
});

describe("blocked-account shell gate (source)", () => {
  it("requireUser scopes live-attempt exemption to the attempt path", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/auth/require-user.ts"),
      "utf8"
    );
    assert.match(src, /isLiveExamAttemptPath/);
    assert.match(src, /x-medverse-pathname/);
    assert.match(src, /owns_live_attempt_session/);
    // Blocked path must check pathname before granting exemption.
    const blockedIdx = src.indexOf(
      "isBlockedAccountStatus(sessionProfile.account_status)"
    );
    const pathIdx = src.indexOf("isLiveExamAttemptPath(path)", blockedIdx);
    const exemptIdx = src.indexOf('rpc("owns_live_attempt_session")', pathIdx);
    assert.ok(blockedIdx > 0 && pathIdx > blockedIdx && exemptIdx > pathIdx);
  });

  it("proxy forwards pathname for RSC layout gates", () => {
    const src = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    assert.match(src, /x-medverse-pathname/);
  });
});
