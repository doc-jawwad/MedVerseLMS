import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { studentSubscriptionErrorMessage } from "../../src/lib/subscriptions/student-errors.ts";

describe("Check 5 Low fixes (source)", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260919160000_check5_low_fixes.sql"
    ),
    "utf8"
  );
  const action = readFileSync(
    join(process.cwd(), "src/lib/actions/subscription-applications.ts"),
    "utf8"
  );
  const materials = readFileSync(
    join(process.cwd(), "src/lib/actions/materials.ts"),
    "utf8"
  );

  it("adds authorize_payment_screenshot_discard with orphan/attached rules", () => {
    assert.match(migration, /authorize_payment_screenshot_discard/);
    assert.match(migration, /screenshot_discard_denied/);
    assert.match(migration, /review_subscription_applications/);
    assert.match(migration, /account_allows_lms/);
    assert.match(action, /authorize_payment_screenshot_discard/);
  });

  it("enforces https-only materials.drive_url at the DB boundary", () => {
    assert.match(migration, /materials_drive_url_https/);
    assert.match(migration, /\^https:\/\/\[/);
    assert.match(materials, /protocol === "https:"/);
  });

  it("revokes client EXECUTE on log_audit", () => {
    assert.match(
      migration,
      /revoke execute on function public\.log_audit\(text, text, uuid, jsonb\)[\s\S]*authenticated/
    );
    assert.match(migration, /grant execute on function public\.log_audit[\s\S]*service_role/);
  });

  it("maps screenshot_discard_denied for students", () => {
    assert.match(
      studentSubscriptionErrorMessage("screenshot_discard_denied"),
      /cannot be discarded/i
    );
  });
});
