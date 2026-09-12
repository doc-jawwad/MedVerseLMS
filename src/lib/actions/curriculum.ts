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

const kindLabel: Record<CurriculumKind, string> = {
  subjects: "subject",
  books: "book",
  chapters: "chapter",
  topics: "topic",
};

// Postgres unique_violation (23505) on a curriculum name means a sibling with
// this name already exists under the same parent — translate that into a
// message an admin can act on instead of leaking the raw constraint name.
function friendlyError(
  error: { code?: string; message: string } | null,
  kind: CurriculumKind,
  name: string
) {
  if (!error) return undefined;
  if (error.code === "23505") {
    return `A ${kindLabel[kind]} named "${name}" already exists here.`;
  }
  return error.message;
}

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
  return { error: friendlyError(error, kind, trimmed) };
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
  return { error: friendlyError(error, kind, trimmed) };
}

export async function deleteCurriculumNode(kind: CurriculumKind, id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from(kind).delete().eq("id", id);
  revalidatePath("/admin/curriculum");
  return { error: error?.message };
}
