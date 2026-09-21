import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStudentShellNav,
  isPaidLmsSectionPath,
  studentHasPaidLmsSections,
} from "../../src/lib/subscriptions/student-section-access.ts";

describe("studentHasPaidLmsSections", () => {
  it("requires live subscription (pending/expired are false)", () => {
    assert.equal(studentHasPaidLmsSections(false), false);
    assert.equal(studentHasPaidLmsSections(true), true);
  });
});

describe("buildStudentShellNav", () => {
  it("shows all years + Blocks for free students; locks Prof. Session", () => {
    const { items, bottomItems } = buildStudentShellNav(false);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));

    assert.equal(byHref["/dashboard"]?.locked, false);
    assert.equal(byHref["/tests"]?.locked, false);
    assert.equal(byHref["/academic/year/1"]?.label, "1st Year MBBS");
    assert.equal(byHref["/academic/year/5"]?.label, "Final Year MBBS");
    assert.ok(
      byHref["/academic/year/1"]?.children?.some(
        (c) => c.href === "/academic/block-1"
      )
    );
    assert.ok(
      byHref["/academic/year/2"]?.children?.some(
        (c) => c.href === "/academic/block-4"
      )
    );
    assert.ok(
      byHref["/academic/year/5"]?.children?.some(
        (c) => c.href === "/academic/medicine"
      )
    );
    assert.equal(byHref["/academic/prof-session"]?.label, "Prof. Session");
    assert.equal(byHref["/academic/prof-session"]?.locked, true);
    assert.equal(byHref["/mcq-bank"], undefined);
    assert.equal(byHref["/resources"], undefined);
    assert.equal(byHref["/library"], undefined);
    // /performance removed from nav — merged into Dashboard
    assert.equal(byHref["/performance"], undefined);

    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/academic", "/contact"]
    );
  });

  it("unlocks Prof. Session for live subscribers", () => {
    const { items, bottomItems } = buildStudentShellNav(true);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));
    assert.equal(byHref["/academic/prof-session"]?.locked, false);
    // /performance removed from nav — merged into Dashboard
    assert.equal(byHref["/performance"], undefined);
    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/academic", "/academic/prof-session"]
    );
  });

  it("keeps the same top-level labels for free and paid", () => {
    const free = buildStudentShellNav(false);
    const paid = buildStudentShellNav(true);
    assert.equal(free.items.length, paid.items.length);
    assert.deepEqual(
      free.items.map((i) => i.label),
      paid.items.map((i) => i.label)
    );
  });
});

describe("isPaidLmsSectionPath", () => {
  it("locks Prof. Session; academic year/block/category stay open", () => {
    assert.equal(isPaidLmsSectionPath("/academic"), false);
    assert.equal(isPaidLmsSectionPath("/academic/year/1"), false);
    assert.equal(isPaidLmsSectionPath("/academic/block-1/mcq-bank"), false);
    assert.equal(isPaidLmsSectionPath("/academic/prof-session"), true);
    assert.equal(isPaidLmsSectionPath("/academic/prof-session/day-1"), true);
    assert.equal(isPaidLmsSectionPath("/mcq-bank"), true);
    assert.equal(isPaidLmsSectionPath("/mock-test"), true);
    assert.equal(isPaidLmsSectionPath("/practice/ospe"), false);
    // /performance redirects to /dashboard — no longer a paid section gate
    assert.equal(isPaidLmsSectionPath("/performance"), false);
    assert.equal(isPaidLmsSectionPath("/tests"), false);
  });
});
