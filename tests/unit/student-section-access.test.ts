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
  it("shows only enrolled year Blocks; locks Prof. Session; omits OSPE Practice top-level", () => {
    const { items, bottomItems } = buildStudentShellNav(false, {
      year_number: 2,
      year_name: "2nd Year MBBS",
    });
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));

    assert.equal(byHref["/dashboard"]?.locked, false);
    assert.equal(byHref["/tests"]?.locked, false);
    assert.equal(byHref["/academic/year/2"]?.label, "2nd Year MBBS");
    assert.equal(byHref["/academic/year/1"], undefined);
    assert.equal(byHref["/academic/year/5"], undefined);
    assert.ok(
      byHref["/academic/year/2"]?.children?.some(
        (c) => c.href === "/academic/block-4"
      )
    );
    assert.ok(
      !byHref["/academic/year/2"]?.children?.some(
        (c) => c.href === "/academic/block-1"
      )
    );
    assert.equal(byHref["/practice/ospe"], undefined);
    assert.equal(byHref["/academic/prof-session"]?.label, "Prof. Session");
    assert.equal(byHref["/academic/prof-session"]?.locked, true);
    assert.equal(byHref["/past-papers"]?.label, "Past Papers");
    assert.equal(byHref["/past-papers"]?.locked, true);
    assert.equal(byHref["/other-services"]?.label, "Other Services");
    assert.equal(byHref["/other-services"]?.locked, false);
    assert.equal(byHref["/career-counseling-series"]?.label, "Career Counseling Series");
    assert.equal(byHref["/career-counseling-series"]?.locked, false);
    assert.equal(byHref["/career-counselling"], undefined);
    assert.equal(byHref["/mcq-bank"], undefined);
    assert.equal(byHref["/resources"], undefined);
    assert.equal(byHref["/library"], undefined);
    assert.equal(byHref["/performance"], undefined);

    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/academic", "/contact"]
    );
  });

  it("unlocks Prof. Session for live subscribers", () => {
    const { items, bottomItems } = buildStudentShellNav(true, {
      year_number: 1,
      year_name: "1st Year MBBS",
    });
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));
    assert.equal(byHref["/academic/prof-session"]?.locked, false);
    assert.equal(byHref["/past-papers"]?.locked, false);
    assert.equal(byHref["/other-services"]?.locked, false);
    assert.equal(byHref["/career-counseling-series"]?.locked, false);
    assert.equal(byHref["/performance"], undefined);
    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/academic", "/academic/prof-session"]
    );
  });

  it("keeps the same top-level labels for free and paid", () => {
    const enrollment = { year_number: 3, year_name: "3rd Year MBBS" };
    const free = buildStudentShellNav(false, enrollment);
    const paid = buildStudentShellNav(true, enrollment);
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
    assert.equal(isPaidLmsSectionPath("/past-papers"), true);
    assert.equal(isPaidLmsSectionPath("/past-papers/abc"), true);
    assert.equal(isPaidLmsSectionPath("/other-services"), false);
    assert.equal(isPaidLmsSectionPath("/career-counseling-series"), false);
    assert.equal(isPaidLmsSectionPath("/career-counseling-series/abc"), false);
    assert.equal(isPaidLmsSectionPath("/practice/ospe"), false);
    assert.equal(isPaidLmsSectionPath("/performance"), false);
    assert.equal(isPaidLmsSectionPath("/tests"), false);
  });
});
