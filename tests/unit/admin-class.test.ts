import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_CLASS_COOKIE,
  adminClassCookieOptions,
  adminClassNeedsSync,
  resolveAdminClassId,
} from "../../src/lib/admin/admin-class.ts";
import { isYearId } from "../../src/lib/admin/year-id.ts";

const Y1 = "11111111-1111-4111-8111-111111111111";
const Y3 = "33333333-3333-4333-8333-333333333333";

describe("admin class source of truth", () => {
  it("exports the durable cookie name used under /admin", () => {
    assert.equal(ADMIN_CLASS_COOKIE, "medverse_admin_year");
    const opts = adminClassCookieOptions();
    assert.equal(opts.path, "/admin");
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
  });

  it("treats the cookie as authoritative when both cookie and ?year= exist", () => {
    assert.equal(resolveAdminClassId(Y1, Y3), Y1);
    assert.equal(resolveAdminClassId(Y3, null), Y3);
    assert.equal(resolveAdminClassId(null, Y3), Y3);
    assert.equal(resolveAdminClassId("not-a-uuid", Y1), Y1);
    assert.equal(resolveAdminClassId(null, "nope"), null);
  });

  it("detects when proxy must sync ?year= onto the cookie", () => {
    assert.equal(adminClassNeedsSync(Y1, Y3), true);
    assert.equal(adminClassNeedsSync(Y3, Y3), false);
    assert.equal(adminClassNeedsSync(null, Y3), true);
    assert.equal(adminClassNeedsSync(Y1, "1"), false);
    assert.ok(isYearId(Y3));
    assert.ok(!isYearId("3"));
  });
});
