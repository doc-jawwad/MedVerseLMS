import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  buildAcademicBreadcrumbs,
  buildStructuralAcademicTree,
  classDisplayName,
  findCategoryBySlug,
  findDaySlotBySlug,
  findSubjectInTree,
  isBlockProductKey,
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

  it("includes block categories with Flashcards placeholder and Notes", () => {
    const ids = BLOCK_CATEGORIES.map((c) => c.id);
    assert.ok(ids.includes("test"));
    assert.ok(ids.includes("ospe"));
    assert.ok(ids.includes("lectures"));
    assert.ok(ids.includes("books"));
    assert.ok(ids.includes("past_papers"));
    assert.ok(ids.includes("notes"));
    assert.ok(ids.includes("flashcards"));
    assert.equal(
      BLOCK_CATEGORIES.find((c) => c.id === "flashcards")?.placeholder,
      true
    );
  });

  it("defines fixed Test day slots", () => {
    assert.deepEqual(
      TEST_DAY_SLOTS.map((s) => s.name),
      ["Syllabus", "Guidelines", "One-liners", "Practice MCQs", "Test MCQ"]
    );
    assert.equal(findDaySlotBySlug("practice-mcqs")?.id, "practice_mcqs");
    assert.equal(findCategoryBySlug("past-papers")?.id, "past_papers");
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

    const testCat = block4!.categories.find((c) => c.id === "test");
    assert.ok(testCat);
    assert.equal(testCat!.folders.length, 3);
    assert.ok(testCat!.folders.every((f) => f.is_day));
    assert.equal(testCat!.folders[0]!.children.length, TEST_DAY_SLOTS.length);
    assert.ok(
      testCat!.folders[0]!.children.every((c) => c.items.length === 0),
      "adapter must not invent content items"
    );

    const flash = block4!.categories.find((c) => c.id === "flashcards");
    assert.equal(flash?.placeholder, true);
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
  });
});

describe("tree-name search", () => {
  it("matches block and day names only", () => {
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
    assert.ok(blockHits.every((h) => h.href.startsWith("/free-resources")));

    const dayHits = searchAcademicTreeNames({ tree, query: "Day 2" });
    assert.ok(dayHits.some((h) => h.kind === "day" && h.name === "Day 2"));

    const categoryHits = searchAcademicTreeNames({ tree, query: "Past Papers" });
    assert.ok(categoryHits.some((h) => h.kind === "category"));

    assert.deepEqual(searchAcademicTreeNames({ tree, query: "   " }), []);
  });
});

describe("paths and breadcrumbs", () => {
  it("labels surfaces and builds crumb trails", () => {
    assert.equal(surfaceLabel("resources"), "Resources");
    assert.equal(surfaceBasePath("library"), "/library");

    const crumbs = buildAcademicBreadcrumbs({
      surface: "resources",
      yearName: "2nd Year MBBS",
      blockName: "Block 4",
      blockSlug: "block-4",
      categoryName: "Test",
      categorySlug: "test",
      dayName: "Day 1",
      daySlug: "day-1",
      slotName: "Syllabus",
      slotSlug: "syllabus",
    });

    assert.equal(crumbs[0]?.label, "Resources");
    assert.equal(crumbs[0]?.href, "/resources");
    assert.equal(crumbs.at(-1)?.label, "Syllabus");
    assert.equal(crumbs.at(-1)?.href, undefined);
  });
});
