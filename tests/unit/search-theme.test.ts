import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructuralAcademicTree,
  searchAcademicTreeNames,
  classDisplayName,
  blocksForYearNumber,
  hrefForAcademicSearchHit,
} from "../../src/lib/academic-tree/index.ts";
import {
  THEME_STORAGE_KEY,
  isThemeMode,
} from "../../src/lib/theme/storage.ts";
import { isExamLikePath } from "../../src/lib/pwa/install.ts";

describe("academic tree search scope", () => {
  const tree = buildStructuralAcademicTree({
    surface: "library",
    year_id: "year-1",
    year_number: 1,
    year_name: "1st Year MBBS",
    has_live_subscription: true,
  });

  it("returns path, content type, lock state, and class", () => {
    const hits = searchAcademicTreeNames({ query: "Block 1", tree });
    assert.ok(hits.length >= 1);
    const hit = hits[0]!;
    assert.equal(hit.kind, "block");
    assert.equal(hit.name, "Block 1");
    assert.equal(hit.class_name, "1st Year MBBS");
    assert.ok(Array.isArray(hit.path_labels));
    assert.ok(hit.path_labels.includes("1st Year MBBS"));
    assert.equal(typeof hit.locked, "boolean");
    assert.ok(hit.href.startsWith("/"));
  });

  it("searches class, category, and prof session — no invented days", () => {
    const classHits = searchAcademicTreeNames({ query: "1st Year", tree });
    assert.ok(classHits.some((h) => h.kind === "class"));

    const categoryHits = searchAcademicTreeNames({ query: "MCQ Bank", tree });
    assert.ok(categoryHits.some((h) => h.kind === "category"));
    const notesHits = searchAcademicTreeNames({ query: "Notes", tree });
    assert.ok(
      notesHits.some(
        (h) =>
          h.kind === "category" &&
          !h.path_labels.includes("Prof. Session")
      ),
      "Notes included in student Academic Block chrome"
    );
    assert.ok(
      notesHits.some(
        (h) =>
          h.kind === "category" && h.path_labels.includes("Prof. Session")
      ),
      "Notes included under Prof. Session subject chrome"
    );

    const dayHits = searchAcademicTreeNames({ query: "Day 1", tree });
    assert.equal(
      dayHits.filter((h) => h.kind === "day").length,
      0,
      "structural tree has empty prof days"
    );

    const profHits = searchAcademicTreeNames({ query: "Prof. Session", tree });
    assert.ok(profHits.some((h) => h.kind === "prof_session"));
  });

  it("does not return day slots or invent stem/PDF hits", () => {
    const syllabus = searchAcademicTreeNames({ query: "Syllabus", tree });
    assert.ok(
      syllabus.some(
        (h) =>
          h.kind === "category" &&
          !h.path_labels.includes("Prof. Session")
      ),
      "Syllabus included in Academic Block chrome"
    );
    assert.ok(
      syllabus.some(
        (h) =>
          h.kind === "category" && h.path_labels.includes("Prof. Session")
      ),
      "Syllabus also under Prof. Session subject chrome"
    );
    assert.equal(
      syllabus.filter((h) => h.kind === "day" || h.kind === "day_slot").length,
      0
    );

    const stemy = searchAcademicTreeNames({
      query: "which of the following",
      tree,
    });
    assert.equal(stemy.length, 0);
  });

  it("marks library nodes locked without subscription", () => {
    const lockedTree = buildStructuralAcademicTree({
      surface: "library",
      year_id: "year-1",
      year_number: 1,
      year_name: "1st Year MBBS",
      has_live_subscription: false,
    });
    const hits = searchAcademicTreeNames({ query: "Block 2", tree: lockedTree });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.locked, true);
  });

  it("respects limit and ignores empty query", () => {
    assert.deepEqual(searchAcademicTreeNames({ query: "   ", tree }), []);
    const limited = searchAcademicTreeNames({ query: "Block", tree, limit: 2 });
    assert.ok(limited.length <= 2);
  });

  it("maps Final Year display and blocks", () => {
    assert.equal(classDisplayName(5), "Final Year MBBS");
    const finals = blocksForYearNumber(5).map((b) => b.name);
    assert.deepEqual(finals, [
      "Medicine",
      "Surgery",
      "Gynecology",
      "Pediatrics",
    ]);
  });
});

describe("theme persistence", () => {
  it("uses a local non-PII storage key and accepts Light/Dark/System", () => {
    assert.equal(THEME_STORAGE_KEY, "medverse-theme");
    assert.equal(isThemeMode("light"), true);
    assert.equal(isThemeMode("dark"), true);
    assert.equal(isThemeMode("system"), true);
    assert.equal(isThemeMode("neon"), false);
  });
});

describe("search hit hrefs (unified /academic IA)", () => {
  it("maps category, folder, class, and day hits onto /academic routes", () => {
    assert.equal(
      hrefForAcademicSearchHit(
        {
          kind: "category",
          name: "Notes",
          path_labels: ["1st Year MBBS", "Block 1", "Notes"],
        },
        "library"
      ),
      "/academic/block-1/notes"
    );
    assert.equal(
      hrefForAcademicSearchHit(
        {
          kind: "folder",
          name: "Sample",
          path_labels: ["1st Year MBBS", "Block 1", "Books", "Sample"],
        },
        "library"
      ),
      "/academic/block-1/books"
    );
    assert.equal(
      hrefForAcademicSearchHit(
        { kind: "class", name: "1st Year MBBS", path_labels: ["1st Year MBBS"] },
        "resources"
      ),
      "/academic"
    );
    assert.equal(
      hrefForAcademicSearchHit(
        {
          kind: "day",
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          name: "Foundations Day",
          path_labels: [
            "1st Year MBBS",
            "Prof. Session",
            "Block 1",
            "MCQ Bank",
            "Foundations Day",
          ],
          product_key: "block-1",
        },
        "resources"
      ),
      "/academic/prof-session/block-1/mcq-bank/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
    assert.equal(
      hrefForAcademicSearchHit(
        {
          kind: "prof_session",
          name: "Prof. Session",
          path_labels: ["1st Year MBBS", "Prof. Session"],
        },
        "library"
      ),
      "/academic/prof-session"
    );
  });
});

describe("exam shell isolation path rule", () => {
  it("reuses isExamLikePath for attempt and preview routes", () => {
    assert.equal(isExamLikePath("/tests/abc/attempt"), true);
    assert.equal(isExamLikePath("/tests/abc/preview"), true);
    assert.equal(isExamLikePath("/dashboard"), false);
    assert.equal(isExamLikePath("/profile"), false);
  });
});
