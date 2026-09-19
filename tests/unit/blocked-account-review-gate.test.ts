import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("blocked-account review gate (Check 5 M1)", () => {
  it("migration requires account_allows_lms for non-admin get_attempt_review", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260919150000_blocked_account_review_gate.sql"
      ),
      "utf8"
    );
    assert.match(src, /account_allows_lms/);
    assert.match(src, /account_not_eligible/);
    assert.match(src, /can_admin_select_attempt_detail/);
    assert.match(src, /set search_path = public/);
    // Admin path must remain before the student account gate short-circuits.
    const adminIdx = src.indexOf("can_admin_select_attempt_detail");
    const gateIdx = src.indexOf("account_allows_lms");
    assert.ok(adminIdx > 0 && gateIdx > adminIdx);
  });

  it("pgTAP covers blocked statuses and preserves live save", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/tests/170_blocked_account_review.sql"),
      "utf8"
    );
    assert.match(src, /restricted student cannot get_attempt_review/);
    assert.match(src, /suspended student cannot get_attempt_review/);
    assert.match(src, /deactivated student cannot get_attempt_review/);
    assert.match(src, /revoked student cannot get_attempt_review/);
    assert.match(src, /save_answer/);
    assert.match(src, /view_students admin can still review/);
  });
});
