import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurriculumData } from "./question-editor";

export async function loadCurriculum(
  supabase: SupabaseClient
): Promise<CurriculumData> {
  const [{ data: years }, { data: subjects }, { data: books }, { data: chapters }, { data: topics }] =
    await Promise.all([
      supabase.from("years").select("id, year_number").order("year_number"),
      supabase.from("subjects").select("id, name, year_id").order("name"),
      supabase.from("books").select("id, name, subject_id").order("name"),
      supabase.from("chapters").select("id, name, book_id").order("sort_order").order("name"),
      supabase.from("topics").select("id, name, chapter_id").order("sort_order").order("name"),
    ]);

  return {
    years: years ?? [],
    subjects: subjects ?? [],
    books: books ?? [],
    chapters: chapters ?? [],
    topics: topics ?? [],
  };
}
