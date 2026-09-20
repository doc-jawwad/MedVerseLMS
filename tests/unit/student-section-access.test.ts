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
  it("locks full-library hubs for free students and keeps Free Resources and Tests active", () => {
    const { items, bottomItems } = buildStudentShellNav(false);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));

    assert.equal(byHref["/dashboard"]?.locked, false);
    assert.equal(byHref["/tests"]?.locked, false);
    assert.equal(byHref["/free-resources"]?.locked, false);
    assert.equal(byHref["/contact"]?.locked, false);
    assert.equal(byHref["/career-counselling"]?.locked, false);
    assert.equal(byHref["/imd-stepwise"]?.locked, false);
    assert.equal(byHref["/subscription"]?.locked, false);
    assert.equal(byHref["/profile"]?.locked, false);

    assert.equal(byHref["/mcq-bank"]?.locked, true);
    assert.equal(byHref["/pearl-points"]?.locked, true);
    assert.equal(byHref["/guidelines"]?.locked, true);
    assert.equal(byHref["/ospe-material"]?.locked, true);
    assert.equal(byHref["/ospe-lectures"]?.locked, true);
    assert.equal(byHref["/books"]?.locked, true);
    assert.equal(byHref["/notes"]?.locked, true);
    assert.equal(byHref["/lectures"]?.locked, true);
    assert.equal(byHref["/performance"]?.locked, true);
    assert.equal(byHref["/practice/ospe"]?.locked, false);

    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/free-resources", "/contact"]
    );
    assert.ok(bottomItems.every((i) => !i.locked));
  });

  it("unlocks full-library hubs for live subscribers", () => {
    const { items, bottomItems } = buildStudentShellNav(true);
    assert.ok(items.every((i) => !i.locked));
    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/tests", "/mcq-bank", "/pearl-points"]
    );
  });

  it("uses one shared item list (no desktop/mobile drift)", () => {
    const free = buildStudentShellNav(false);
    const paid = buildStudentShellNav(true);
    assert.equal(free.items.length, paid.items.length);
    assert.deepEqual(
      free.items.map((i) => i.href),
      paid.items.map((i) => i.href)
    );
  });
});

describe("isPaidLmsSectionPath", () => {
  it("matches full-library hubs and nested routes, not Tests or Free Resources", () => {
    assert.equal(isPaidLmsSectionPath("/mcq-bank"), true);
    assert.equal(isPaidLmsSectionPath("/practice"), true);
    assert.equal(isPaidLmsSectionPath("/practice/abc"), true);
    assert.equal(isPaidLmsSectionPath("/practice/ospe"), false);
    assert.equal(isPaidLmsSectionPath("/practice/ospe/x"), false);
    assert.equal(isPaidLmsSectionPath("/pearl-points"), true);
    assert.equal(isPaidLmsSectionPath("/guidelines"), true);
    assert.equal(isPaidLmsSectionPath("/performance"), true);
    assert.equal(isPaidLmsSectionPath("/materials"), true);
    assert.equal(isPaidLmsSectionPath("/tests"), false);
    assert.equal(isPaidLmsSectionPath("/tests/x/attempt"), false);
    assert.equal(isPaidLmsSectionPath("/dashboard"), false);
    assert.equal(isPaidLmsSectionPath("/free-resources"), false);
    assert.equal(isPaidLmsSectionPath("/free-resources/mcq-bank"), false);
    assert.equal(isPaidLmsSectionPath("/contact"), false);
    assert.equal(isPaidLmsSectionPath("/subscription"), false);
  });
});
