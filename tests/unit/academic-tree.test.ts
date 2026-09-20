import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  PROF_SESSION_LABEL,
  PROF_SESSION_SLUG,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  buildAcademicBreadcrumbs,
  buildStructuralAcademicTree,
  classDisplayName,
  findCategoryBySlug,
  findDaySlotBySlug,
  findSubjectInTree,
  isBlockProductKey,
  profSessionHref,
  searchAcademicTreeNames,
  surfaceBasePath,
  surfaceLabel,
} from "../../src/lib/academic-tree/index.ts";

describe("product structure freeze", () => {
  it("maps years 1–4 to Blocks and Final Year to clinical subjects", () => {
    assert.deepEqual(
      blocksForYearNumber(1).map((b) => b.name),
      ["Block 1", "Block 2", "Block 3"]
    );
    assert.deepEqual(
      blocksForYearNumber(2).map((b) => b.name),
      ["Block 4", "Block 5", "Block 6"]
    );
    assert.deepEqual(
      blocksForYearNumber(3).map((b) => b.name),
      ["Block 7", "Block 8", "Block 9"]
    );
    assert.deepEqual(
      blocksForYearNumber(4).map((b) => b.name),
      ["Block 10", "Block 11", "Block 12"]
    );
    assert.deepEqual(
      blocksForYearNumber(5).map((b) => b.name),
      ["Medicine", "Surgery", "Gynecology", "Pediatrics"]
    );
    assert.equal(BLOCK_PRODUCT_DEFS.length, 16);
  });

  it("includes the eight student block categories", () => {
    const ids = BLOCK_CATEGORIES.map((c) => c.id);
    assert.deepEqual(ids, [
      "mcq_bank",
      "pearl_points",
      "guidelines",
      "ospe_material",
      "ospe_lectures",
      "books",
      "notes",
      "lectures",
    ]);
    assert.equal(findCategoryBySlug("pearl-points")?.id, "pearl_points");
    assert.equal(findCategoryBySlug("ospe-material")?.id, "ospe_material");
  });

  it("defines fixed Prof. Session day slots", () => {
    assert.deepEqual(
      TEST_DAY_SLOTS.map((s) => s.name),
      [
        "Syllabus",
        "Guidelines",
        "One-liners / Pearl Points",
        "Practice MCQs",
        "Test MCQ",
      ]
    );
    assert.equal(findDaySlotBySlug("practice-mcqs")?.id, "practice_mcqs");
    assert.equal(PROF_SESSION_LABEL, "Prof. Session");
    assert.equal(PROF_SESSION_SLUG, "prof-session");
  });

  it("formats class display names", () => {
    assert.equal(classDisplayName(5), "Final Year MBBS");
    assert.equal(classDisplayName(2), "2nd Year MBBS");
  });
});

describe("structural academic tree adapter", () => {
  it("builds Resources tree for 2nd Year with unlocked navigation", () => {
    const tree = buildStructuralAcademicTree({
      surface: "resources",
      year_id: "y2",
      year_number: 2,
      year_name: "2nd Year MBBS",
      has_live_subscription: false,
    });

    assert.equal(tree.surface, "resources");
    assert.equal(tree.from_adapter, true);
    assert.equal(tree.subjects.length, 3);
    assert.ok(tree.subjects.every((s) => !s.locked));
    assert.ok(isBlockProductKey(tree.subjects[0]!.product_key));

    const block4 = findSubjectInTree(tree, "block-4");
    assert.ok(block4);
    assert.equal(block4!.categories.length, BLOCK_CATEGORIES.length);
    assert.ok(block4!.categories.every((c) => c.folders.length === 0));

    assert.ok(tree.prof_session);
    assert.equal(tree.prof_session.days.length, 3);
    assert.ok(tree.prof_session.days.every((f) => f.is_day));
    assert.equal(
      tree.prof_session.days[0]!.children.length,
      TEST_DAY_SLOTS.length
    );
    assert.ok(
      tree.prof_session.days[0]!.children.every((c) => c.items.length === 0),
      "adapter must not invent content items"
    );
  });

  it("locks Library tree when subscription is not live", () => {
    const tree = buildStructuralAcademicTree({
      surface: "library",
      year_id: "y1",
      year_number: 1,
      year_name: "1st Year MBBS",
      has_live_subscription: false,
    });
    assert.ok(tree.subjects.every((s) => s.locked));
    assert.equal(tree.prof_session.locked, true);
  });

  it("opens Library tree when subscription is live", () => {
    const tree = buildStructuralAcademicTree({
      surface: "library",
      year_id: "y5",
      year_number: 5,
      year_name: "Final Year MBBS",
      has_live_subscription: true,
    });
    assert.equal(tree.subjects.length, 4);
    assert.ok(tree.subjects.every((s) => !s.locked));
    assert.deepEqual(
      tree.subjects.map((s) => s.product_key),
      ["medicine", "surgery", "gynecology", "pediatrics"]
    );
    assert.equal(tree.prof_session.locked, false);
  });
});

describe("tree-name search", () => {
  it("matches block, category, prof session, and day names", () => {
    const tree = buildStructuralAcademicTree({
      surface: "resources",
      year_id: "y2",
      year_number: 2,
      year_name: "2nd Year MBBS",
      has_live_subscription: false,
    });

    const blockHits = searchAcademicTreeNames({
      tree,
      query: "Block 4",
      limit: 10,
    });
    assert.ok(blockHits.some((h) => h.kind === "block" && h.name === "Block 4"));
    assert.ok(blockHits.every((h) => h.href.startsWith("/resources")));

    const dayHits = searchAcademicTreeNames({ tree, query: "Day 2" });
    assert.ok(dayHits.some((h) => h.kind === "day" && h.name === "Day 2"));
    assert.ok(
      dayHits.some((h) => h.href === "/resources/prof-session/day-2")
    );

    const profHits = searchAcademicTreeNames({ tree, query: "Prof" });
    assert.ok(profHits.some((h) => h.kind === "prof_session"));

    const categoryHits = searchAcademicTreeNames({ tree, query: "MCQ Bank" });
    assert.ok(categoryHits.some((h) => h.kind === "category"));

    assert.deepEqual(searchAcademicTreeNames({ tree, query: "   " }), []);
  });
});

describe("paths and breadcrumbs", () => {
  it("labels surfaces and builds crumb trails under Prof. Session", () => {
    assert.equal(surfaceLabel("resources"), "Resources");
    assert.equal(surfaceBasePath("library"), "/library");
    assert.equal(profSessionHref("resources"), "/resources/prof-session");

    const crumbs = buildAcademicBreadcrumbs({
      surface: "resources",
      yearName: "2nd Year MBBS",
      profSession: true,
      dayName: "Day 1",
      daySlug: "day-1",
      slotName: "Syllabus",
      slotSlug: "syllabus",
    });

    assert.equal(crumbs[0]?.label, "Resources");
    assert.equal(crumbs[0]?.href, "/resources");
    assert.equal(crumbs[1]?.label, PROF_SESSION_LABEL);
    assert.equal(crumbs.at(-1)?.label, "Syllabus");
    assert.equal(crumbs.at(-1)?.href, undefined);
  });
});
