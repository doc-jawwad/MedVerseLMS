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
  it("locks paid LMS sections for free students and keeps Free Resources active", () => {
    const { items, bottomItems } = buildStudentShellNav(false);
    const byHref = Object.fromEntries(items.map((i) => [i.href, i]));

    assert.equal(byHref["/dashboard"]?.locked, false);
    assert.equal(byHref["/free-resources"]?.locked, false);
    assert.equal(byHref["/subscription"]?.locked, false);
    assert.equal(byHref["/profile"]?.locked, false);

    assert.equal(byHref["/materials"]?.locked, true);
    assert.equal(byHref["/practice"]?.locked, true);
    assert.equal(byHref["/tests"]?.locked, true);
    assert.equal(byHref["/performance"]?.locked, true);

    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/free-resources", "/subscription", "/profile"]
    );
    assert.ok(bottomItems.every((i) => !i.locked));
  });

  it("unlocks paid LMS sections for live subscribers", () => {
    const { items, bottomItems } = buildStudentShellNav(true);
    assert.ok(items.every((i) => !i.locked));
    assert.deepEqual(
      bottomItems.map((i) => i.href),
      ["/dashboard", "/practice", "/tests", "/performance"]
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
  it("matches section hubs and nested routes", () => {
    assert.equal(isPaidLmsSectionPath("/practice"), true);
    assert.equal(isPaidLmsSectionPath("/practice/abc"), true);
    assert.equal(isPaidLmsSectionPath("/tests/x/attempt"), true);
    assert.equal(isPaidLmsSectionPath("/performance"), true);
    assert.equal(isPaidLmsSectionPath("/materials"), true);
    assert.equal(isPaidLmsSectionPath("/dashboard"), false);
    assert.equal(isPaidLmsSectionPath("/free-resources"), false);
    assert.equal(isPaidLmsSectionPath("/subscription"), false);
  });
});
