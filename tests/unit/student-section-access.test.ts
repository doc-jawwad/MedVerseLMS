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
  const enrollment = { year_number: 1, year_name: "1st Year MBBS" };

  it("builds class→blocks nav for free students without legacy library hubs", () => {
    const { items, bottomItems } = buildStudentShellNav(false, enrollment);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));

    assert.equal(byHref["/dashboard"]?.locked, false);
    assert.equal(byHref["/tests"]?.locked, false);
    assert.equal(byHref["/resources"]?.locked, false);
    assert.equal(byHref["/resources"]?.label, "1st Year MBBS");
    assert.ok(
      byHref["/resources"]?.children?.some((c) => c.href === "/resources/block-1")
    );
    assert.equal(byHref["/resources/prof-session"]?.label, "Prof. Session");
    assert.equal(byHref["/contact"]?.locked, false);
    assert.equal(byHref["/mcq-bank"], undefined);
    assert.equal(byHref["/free-resources"], undefined);
    assert.equal(byHref["/performance"]?.locked, true);
    assert.equal(byHref["/practice/ospe"]?.locked, false);

    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/resources", "/contact"]
    );
    assert.ok(bottomItems.every((i) => !i.locked));
  });

  it("uses Library surface and unlocks Performance for live subscribers", () => {
    const { items, bottomItems } = buildStudentShellNav(true, enrollment);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));
    assert.ok(items.every((i) => !i.locked));
    assert.equal(byHref["/library"]?.label, "1st Year MBBS");
    assert.ok(
      byHref["/library"]?.children?.some((c) => c.href === "/library/block-2")
    );
    assert.equal(byHref["/library/prof-session"]?.label, "Prof. Session");
    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/library", "/library/prof-session"]
    );
  });

  it("keeps the same top-level labels for free and paid (surface differs)", () => {
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
  it("treats /library as paid and /resources as free; legacy hubs stay paid", () => {
    assert.equal(isPaidLmsSectionPath("/library"), true);
    assert.equal(isPaidLmsSectionPath("/library/block-1"), true);
    assert.equal(isPaidLmsSectionPath("/resources"), false);
    assert.equal(isPaidLmsSectionPath("/resources/block-1/mcq-bank"), false);
    assert.equal(isPaidLmsSectionPath("/mcq-bank"), true);
    assert.equal(isPaidLmsSectionPath("/practice"), true);
    assert.equal(isPaidLmsSectionPath("/practice/ospe"), false);
    assert.equal(isPaidLmsSectionPath("/performance"), true);
    assert.equal(isPaidLmsSectionPath("/tests"), false);
    assert.equal(isPaidLmsSectionPath("/free-resources"), false);
    assert.equal(isPaidLmsSectionPath("/contact"), false);
  });
});
