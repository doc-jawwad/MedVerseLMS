import type { SupabaseClient } from "@supabase/supabase-js";

export type CurriculumTreeData = {
  years: { id: string; year_number: number }[];
  subjects: { id: string; name: string; year_id: string }[];
  books: { id: string; name: string; subject_id: string }[];
  chapters: { id: string; name: string; book_id: string }[];
  topics: { id: string; name: string; chapter_id: string }[];
};

export type CurriculumLoadOptions = {
  /** When set, only load subjects/books/chapters/topics for this year. */
  yearId?: string;
};

/**
 * Full curriculum tree for editors that need cross-year navigation
 * (question editor). Prefer {@link loadCurriculumFilterCascade} on Test
 * Builder — shipping every topic into RSC is expensive.
 */
export async function loadCurriculum(
  supabase: SupabaseClient,
  options: CurriculumLoadOptions = {}
): Promise<CurriculumTreeData> {
  const yearId = options.yearId;

  const yearsQuery = supabase
    .from("years")
    .select("id, year_number")
    .order("year_number");

  let subjectsQuery = supabase
    .from("subjects")
    .select("id, name, year_id")
    .order("name");
  let booksQuery = supabase
    .from("books")
    .select("id, name, subject_id")
    .order("name");
  let chaptersQuery = supabase
    .from("chapters")
    .select("id, name, book_id")
    .order("sort_order")
    .order("name");
  let topicsQuery = supabase
    .from("topics")
    .select("id, name, chapter_id")
    .order("sort_order")
    .order("name");

  if (yearId) {
    subjectsQuery = subjectsQuery.eq("year_id", yearId);
    booksQuery = booksQuery.eq("year_id", yearId);
    chaptersQuery = chaptersQuery.eq("year_id", yearId);
    topicsQuery = topicsQuery.eq("year_id", yearId);
  }

  const [
    { data: years },
    { data: subjects },
    { data: books },
    { data: chapters },
    { data: topics },
  ] = await Promise.all([
    yearsQuery,
    subjectsQuery,
    booksQuery,
    chaptersQuery,
    topicsQuery,
  ]);

  return {
    years: years ?? [],
    subjects: subjects ?? [],
    books: books ?? [],
    chapters: chapters ?? [],
    topics: topics ?? [],
  };
}

export type CurriculumFilterOptions = {
  yearId: string;
  subjectId?: string;
  bookId?: string;
  chapterId?: string;
};

/**
 * Cascade-aware curriculum slices for Test Builder filters.
 * Only loads the levels needed for the current URL filter state so the
 * initial RSC payload stays small even when a year has thousands of topics.
 * Subjects come from the page's year-scoped subject list (already fetched).
 */
export async function loadCurriculumFilterCascade(
  supabase: SupabaseClient,
  options: CurriculumFilterOptions
): Promise<{
  books: { id: string; name: string; subject_id: string }[];
  chapters: { id: string; name: string; book_id: string }[];
  topics: { id: string; name: string; chapter_id: string }[];
}> {
  const { yearId, subjectId, bookId, chapterId } = options;

  const booksPromise = subjectId
    ? supabase
        .from("books")
        .select("id, name, subject_id")
        .eq("year_id", yearId)
        .eq("subject_id", subjectId)
        .order("name")
    : Promise.resolve({ data: [] as { id: string; name: string; subject_id: string }[] });

  const chaptersPromise = bookId
    ? supabase
        .from("chapters")
        .select("id, name, book_id")
        .eq("year_id", yearId)
        .eq("book_id", bookId)
        .order("sort_order")
        .order("name")
    : Promise.resolve({ data: [] as { id: string; name: string; book_id: string }[] });

  const topicsPromise = chapterId
    ? supabase
        .from("topics")
        .select("id, name, chapter_id")
        .eq("year_id", yearId)
        .eq("chapter_id", chapterId)
        .order("sort_order")
        .order("name")
    : Promise.resolve({ data: [] as { id: string; name: string; chapter_id: string }[] });

  const [{ data: books }, { data: chapters }, { data: topics }] = await Promise.all([
    booksPromise,
    chaptersPromise,
    topicsPromise,
  ]);

  return {
    books: books ?? [],
    chapters: chapters ?? [],
    topics: topics ?? [],
  };
}
