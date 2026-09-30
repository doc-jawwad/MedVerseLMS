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

  it("includes student Block chrome categories with Notes and Syllabus", () => {
    const ids = BLOCK_CATEGORIES.map((c) => c.id);
    assert.deepEqual(ids, [
      "mcq_bank",
      "one_liner",
      "guidelines",
      "books",
      "lectures",
      "notes",
      "syllabus",
      "ospe_material",
      "ospe_lectures",
    ]);
    assert.equal(findCategoryBySlug("one-liner")?.id, "one_liner");
    assert.equal(findCategoryBySlug("ospe-material")?.id, "ospe_material");
    assert.equal(findCategoryBySlug("notes")?.id, "notes");
    assert.equal(findCategoryBySlug("syllabus")?.id, "syllabus");
  });

  it("defines fixed Prof. Session day slots", () => {
    assert.deepEqual(
      TEST_DAY_SLOTS.map((s) => s.name),
      ["Guidelines", "LoS", "Practice MCQs", "Test MCQs", "One-Liners"]
    );
    assert.equal(findDaySlotBySlug("practice-mcqs")?.id, "practice_mcqs");
    assert.equal(findDaySlotBySlug("los")?.id, "los");
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
    assert.equal(
      tree.prof_session.subjects.length,
      0,
      "free structural tree must lock Prof. Session with empty subjects"
    );
    assert.equal(tree.prof_session.locked, true);
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
    assert.equal(tree.prof_session.subjects.length, 4);
    assert.ok(
      tree.prof_session.subjects.every((s) => s.days.length === 0),
      "structural tree must not invent Day 1–3"
    );
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
    assert.ok(blockHits.every((h) => h.href.startsWith("/academic")));

    const dayHits = searchAcademicTreeNames({ tree, query: "Day 2" });
    assert.equal(
      dayHits.filter((h) => h.kind === "day").length,
      0,
      "empty prof days must not invent Day 2 search hits"
    );

    const profHits = searchAcademicTreeNames({ tree, query: "Prof" });
    assert.ok(profHits.some((h) => h.kind === "prof_session"));

    const categoryHits = searchAcademicTreeNames({ tree, query: "MCQ Bank" });
    assert.ok(categoryHits.some((h) => h.kind === "category"));

    assert.deepEqual(searchAcademicTreeNames({ tree, query: "   " }), []);
  });
});

describe("paths and breadcrumbs", () => {
  it("uses unified /academic paths and Prof. Session crumbs", () => {
    assert.equal(surfaceLabel("resources"), "Academic");
    assert.equal(surfaceBasePath("library"), "/academic");
    assert.equal(profSessionHref("resources"), "/academic/prof-session");

    const crumbs = buildAcademicBreadcrumbs({
      surface: "resources",
      yearName: "2nd Year MBBS",
      profSession: true,
      blockName: "Block 4",
      blockSlug: "block-4",
      categoryName: "MCQ Bank",
      categorySlug: "mcq-bank",
      dayName: "Day 1",
      daySlug: "day-1",
      slotName: "Guidelines",
      slotSlug: "guidelines",
    });

    assert.equal(crumbs[0]?.label, "Academic");
    assert.equal(crumbs[0]?.href, "/academic");
    assert.equal(crumbs[1]?.label, PROF_SESSION_LABEL);
    assert.equal(crumbs.at(-1)?.label, "Guidelines");
    assert.equal(crumbs.at(-1)?.href, undefined);
  });
});
