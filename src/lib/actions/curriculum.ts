"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Admin curriculum CRUD. RLS (admin-only policies) is the real gate;
// these actions are transport + revalidation.

export type CurriculumKind = "subjects" | "books" | "chapters" | "topics";

const parentColumn: Record<CurriculumKind, string | null> = {
  subjects: "year_id",
  books: "subject_id",
  chapters: "book_id",
  topics: "chapter_id",
};

export async function addCurriculumNode(
  kind: CurriculumKind,
  parentId: string,
  name: string
) {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const supabase = await createClient();
  const col = parentColumn[kind]!;
  const { error } = await supabase
    .from(kind)
    .insert({ [col]: parentId, name: trimmed });
  revalidatePath("/admin/curriculum");
  return { error: error?.message };
}

export async function renameCurriculumNode(
  kind: CurriculumKind,
  id: string,
  name: string
) {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from(kind)
    .update({ name: trimmed })
    .eq("id", id);
  revalidatePath("/admin/curriculum");
  return { error: error?.message };
}

export async function deleteCurriculumNode(kind: CurriculumKind, id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from(kind).delete().eq("id", id);
  revalidatePath("/admin/curriculum");
  return { error: error?.message };
}
