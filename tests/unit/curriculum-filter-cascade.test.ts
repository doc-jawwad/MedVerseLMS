import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  curriculumTreeJsonBytes,
  loadCurriculum,
  loadCurriculumEditor,
  loadCurriculumFilterCascade,
} from "../../src/lib/admin/curriculum-load.ts";

type Row = Record<string, unknown>;

function mockSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const filters: Array<(r: Row) => boolean> = [];
    const api: {
      select: (...args: unknown[]) => typeof api;
      eq: (col: string, val: unknown) => typeof api;
      order: (...args: unknown[]) => typeof api;
      then: (
        resolve: (v: { data: Row[] }) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise<unknown>;
    } = {
      select() {
        return api;
      },
      eq(col, val) {
        filters.push((r) => r[col] === val);
        return api;
      },
      order() {
        return api;
      },
      then(resolve, reject) {
        try {
          const data = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data }).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    return api;
  }
  return { from } as never;
}

const YEARS = [
  { id: "y1", year_number: 1 },
  { id: "y5", year_number: 5 },
];
const SUBJECTS = [
  { id: "s1", name: "A", year_id: "y1" },
  { id: "s5", name: "B", year_id: "y5" },
];
const BOOKS = [
  { id: "b1", name: "Book1", subject_id: "s1", year_id: "y1" },
  { id: "b5", name: "Book5", subject_id: "s5", year_id: "y5" },
];
const CHAPTERS = [
  { id: "c1", name: "Ch1", book_id: "b1", year_id: "y1" },
  { id: "c5", name: "Ch5", book_id: "b5", year_id: "y5" },
];
const TOPICS = [
  { id: "t1", name: "T1", chapter_id: "c1", year_id: "y1" },
  { id: "t5a", name: "T5a", chapter_id: "c5", year_id: "y5" },
  { id: "t5b", name: "T5b", chapter_id: "c5", year_id: "y5" },
];

describe("loadCurriculum year scope", () => {
  it("loads all rows when yearId omitted", async () => {
    const supabase = mockSupabase({
      years: YEARS,
      subjects: SUBJECTS,
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculum(supabase);
    assert.equal(data.topics.length, 3);
    assert.equal(data.subjects.length, 2);
  });

  it("scopes subjects/books/chapters/topics to yearId", async () => {
    const supabase = mockSupabase({
      years: YEARS,
      subjects: SUBJECTS,
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculum(supabase, { yearId: "y5" });
    assert.deepEqual(
      data.subjects.map((s) => s.id),
      ["s5"]
    );
    assert.deepEqual(
      data.books.map((b) => b.id),
      ["b5"]
    );
    assert.deepEqual(
      data.topics.map((t) => t.id).sort(),
      ["t5a", "t5b"]
    );
    // Years list stays complete for year pickers that reuse this helper.
    assert.equal(data.years.length, 2);
  });
});

describe("loadCurriculumFilterCascade", () => {
  it("loads nothing under subjects when no filter selected", async () => {
    const supabase = mockSupabase({
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculumFilterCascade(supabase, { yearId: "y5" });
    assert.deepEqual(data.books, []);
    assert.deepEqual(data.chapters, []);
    assert.deepEqual(data.topics, []);
  });

  it("loads only books for selected subject", async () => {
    const supabase = mockSupabase({
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculumFilterCascade(supabase, {
      yearId: "y5",
      subjectId: "s5",
    });
    assert.deepEqual(
      data.books.map((b) => b.id),
      ["b5"]
    );
    assert.deepEqual(data.chapters, []);
    assert.deepEqual(data.topics, []);
  });

  it("loads chapters/topics only for selected book/chapter", async () => {
    const supabase = mockSupabase({
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculumFilterCascade(supabase, {
      yearId: "y5",
      subjectId: "s5",
      bookId: "b5",
      chapterId: "c5",
    });
    assert.equal(data.books.length, 1);
    assert.equal(data.chapters.length, 1);
    assert.deepEqual(
      data.topics.map((t) => t.id).sort(),
      ["t5a", "t5b"]
    );
  });
});

describe("loadCurriculumEditor", () => {
  const root = path.resolve(import.meta.dirname, "../..");

  it("loads years+subjects only when no subject is selected", async () => {
    const supabase = mockSupabase({
      years: YEARS,
      subjects: SUBJECTS,
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculumEditor(supabase, { yearId: "y5" });
    assert.equal(data.years.length, 2);
    assert.equal(data.subjects.length, 2);
    assert.deepEqual(data.books, []);
    assert.deepEqual(data.chapters, []);
    assert.deepEqual(data.topics, []);
  });

  it("loads cascade slices for the selected branch only", async () => {
    const supabase = mockSupabase({
      years: YEARS,
      subjects: SUBJECTS,
      books: BOOKS,
      chapters: CHAPTERS,
      topics: TOPICS,
    });
    const data = await loadCurriculumEditor(supabase, {
      yearId: "y5",
      subjectId: "s5",
      bookId: "b5",
      chapterId: "c5",
    });
    assert.deepEqual(
      data.books.map((b) => b.id),
      ["b5"]
    );
    assert.deepEqual(
      data.chapters.map((c) => c.id),
      ["c5"]
    );
    assert.deepEqual(
      data.topics.map((t) => t.id).sort(),
      ["t5a", "t5b"]
    );
  });

  it("keeps editor JSON far smaller than a full topic tree", async () => {
    const manyTopics = [
      ...TOPICS,
      ...Array.from({ length: 14_997 }, (_, i) => ({
        id: `tx${i}`,
        name: `Topic name ${i} extra padding`,
        chapter_id: "c-other",
        year_id: "y5",
      })),
    ];
    const tables = {
      years: YEARS,
      subjects: SUBJECTS,
      books: BOOKS,
      chapters: CHAPTERS,
      topics: manyTopics,
    };
    const full = await loadCurriculum(mockSupabase(tables));
    const createPage = await loadCurriculumEditor(mockSupabase(tables), {
      yearId: "y5",
    });
    const editPage = await loadCurriculumEditor(mockSupabase(tables), {
      yearId: "y5",
      subjectId: "s5",
      bookId: "b5",
      chapterId: "c5",
    });
    const fullBytes = curriculumTreeJsonBytes(full);
    const createBytes = curriculumTreeJsonBytes(createPage);
    const editBytes = curriculumTreeJsonBytes(editPage);
    assert.equal(full.topics.length, 15_000);
    assert.equal(createPage.topics.length, 0);
    assert.equal(editPage.topics.length, 2);
    assert.ok(
      createBytes * 50 < fullBytes,
      `create payload ${createBytes} vs full ${fullBytes}`
    );
    assert.ok(
      editBytes * 20 < fullBytes,
      `edit payload ${editBytes} vs full ${fullBytes}`
    );
  });

  it("Question Editor pages do not call unscoped loadCurriculum()", () => {
    const neu = fs.readFileSync(
      path.join(root, "src/app/(admin)/admin/questions/new/page.tsx"),
      "utf8"
    );
    const edit = fs.readFileSync(
      path.join(root, "src/app/(admin)/admin/questions/[id]/page.tsx"),
      "utf8"
    );
    assert.match(neu, /loadCurriculumEditor/);
    assert.match(edit, /loadCurriculumEditor/);
    assert.doesNotMatch(neu, /loadCurriculum\(supabase\)/);
    assert.doesNotMatch(edit, /loadCurriculum\(supabase\)/);
  });
});
