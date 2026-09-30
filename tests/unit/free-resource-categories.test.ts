import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFreeResourceCategories } from "../../src/lib/library/free-categories.ts";
import { belongsOnFreeResources } from "../../src/lib/library/free-surface.ts";

describe("belongsOnFreeResources", () => {
  it("includes free entitlement when accessible", () => {
    assert.equal(
      belongsOnFreeResources({
        entitlement: "free",
        accessible: true,
      }),
      true
    );
  });

  it("excludes paid items unlocked only by subscription", () => {
    assert.equal(
      belongsOnFreeResources({
        entitlement: "any_subscription",
        accessible: true,
        hasPersonalGrant: false,
      }),
      false
    );
  });

  it("includes paid items with a personal grant", () => {
    assert.equal(
      belongsOnFreeResources({
        entitlement: "any_subscription",
        accessible: true,
        hasPersonalGrant: true,
      }),
      true
    );
  });

  it("excludes inaccessible free items (e.g. restricted)", () => {
    assert.equal(
      belongsOnFreeResources({
        entitlement: "free",
        accessible: false,
      }),
      false
    );
  });
});

describe("buildFreeResourceCategories", () => {
  it("omits empty types and only includes curated free / granted items", () => {
    const cards = buildFreeResourceCategories({
      practice: [
        {
          subject_id: "s1",
          granted: true,
          approved_questions: 20,
          entitlement: "free",
        },
        {
          subject_id: "s-paid",
          granted: true,
          approved_questions: 50,
          entitlement: "any_subscription",
        },
        {
          subject_id: "s2",
          granted: false,
          approved_questions: 100,
          entitlement: "free",
        },
        {
          subject_id: "s3",
          granted: true,
          approved_questions: 0,
          entitlement: "free",
        },
        {
          subject_id: "s-grant",
          granted: true,
          approved_questions: 5,
          entitlement: "any_subscription",
          hasPersonalGrant: true,
        },
      ],
      folders: [
        {
          id: "f-guide",
          library_type: "guidelines",
          subject_id: "s1",
          entitlement: "free",
          updated_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "f-books",
          library_type: "books",
          subject_id: "s1",
          entitlement: "any_subscription",
          updated_at: "2026-09-02T00:00:00Z",
        },
        {
          id: "f-notes",
          library_type: "notes",
          subject_id: "s1",
          entitlement: "free",
          updated_at: "2026-09-03T00:00:00Z",
        },
        {
          id: "f-paid-grant",
          library_type: "lectures",
          subject_id: "s1",
          entitlement: "any_subscription",
          updated_at: "2026-09-04T00:00:00Z",
        },
        {
          id: "f-one-liner",
          library_type: "one_liner",
          subject_id: "s1",
          entitlement: "free",
          updated_at: "2026-09-08T00:00:00Z",
        },
        {
          id: "f-one-liner-paid",
          library_type: "one_liner",
          subject_id: "s2",
          entitlement: "any_subscription",
          updated_at: "2026-09-09T00:00:00Z",
        },
      ],
      accessibleFolderIds: [
        "f-guide",
        "f-notes",
        "f-books",
        "f-paid-grant",
        "f-one-liner",
        "f-one-liner-paid",
      ],
      grantedFolderIds: ["f-paid-grant"],
      materials: [
        { folder_id: "f-guide", updated_at: "2026-09-10T00:00:00Z" },
        { folder_id: "f-guide", updated_at: "2026-09-11T00:00:00Z" },
        { folder_id: "f-books", updated_at: "2026-09-12T00:00:00Z" },
        { folder_id: "f-paid-grant", updated_at: "2026-09-13T00:00:00Z" },
        { folder_id: "f-one-liner", updated_at: "2026-09-08T00:00:00Z" },
        { folder_id: "f-one-liner-paid", updated_at: "2026-09-09T00:00:00Z" },
      ],
    });

    assert.deepEqual(
      cards.map((c) => c.id),
      ["mcq_bank", "one_liner", "guidelines", "lectures"]
    );
    assert.equal(cards[0]?.itemCount, 25); // free 20 + granted paid 5
    assert.equal(cards[0]?.subjectCount, 2);
    assert.equal(cards[1]?.itemCount, 1);
    assert.equal(cards[2]?.itemCount, 2);
    assert.ok(!cards.some((c) => c.id === "books"));
    assert.ok(!cards.some((c) => c.id === "notes"));
  });
});
