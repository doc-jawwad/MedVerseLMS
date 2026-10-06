"use server";

import { actionRpcResult, toClientActionError } from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Admin curriculum CRUD. RLS (manage_curriculum writes) is the real gate;
// these actions are transport + UX permission check + revalidation.

export type CurriculumKind = "subjects" | "books" | "chapters" | "topics";

export type CurriculumChildKind = "books" | "chapters" | "topics";

/** On-demand children for cascading pickers (Test Builder + Question Editor). */
export async function listCurriculumChildren(
  kind: CurriculumChildKind,
  parentId: string
): Promise<{
  items: { id: string; name: string }[];
  error?: string;
}> {
  if (!parentId) return { items: [] };
  const supabase = await createClient();
  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
  if (adminErr || !isAdmin) {
    return { items: [], error: "permission_denied" };
  }

  if (kind === "books") {
    const { data, error } = await supabase
      .from("books")
      .select("id, name")
      .eq("subject_id", parentId)
      .order("name");
    if (error) return { items: [], error: toClientActionError(error, "curriculum") };
    return { items: data ?? [] };
  }
  if (kind === "chapters") {
    const { data, error } = await supabase
      .from("chapters")
      .select("id, name")
      .eq("book_id", parentId)
      .order("sort_order")
      .order("name");
    if (error) return { items: [], error: toClientActionError(error, "curriculum") };
    return { items: data ?? [] };
  }
  const { data, error } = await supabase
    .from("topics")
    .select("id, name")
    .eq("chapter_id", parentId)
    .order("sort_order")
    .order("name");
  if (error) return { items: [], error: toClientActionError(error, "curriculum") };
  return { items: data ?? [] };
}

async function requireCurriculumWrite() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_permission", {
    p_code: "manage_curriculum",
  });
  if (error || !data) {
    return { supabase, error: "permission_denied" as const };
  }
  return { supabase, error: null };
}

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
  return toClientActionError(error, "curriculum");
}

export async function addCurriculumNode(
  kind: CurriculumKind,
  parentId: string,
  name: string
) {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required." };

  const gate = await requireCurriculumWrite();
  if (gate.error) return { error: gate.error };
  const col = parentColumn[kind]!;
  const { error } = await gate.supabase
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

  const gate = await requireCurriculumWrite();
  if (gate.error) return { error: gate.error };
  const { error } = await gate.supabase
    .from(kind)
    .update({ name: trimmed })
    .eq("id", id);
  revalidatePath("/admin/curriculum");
  return { error: friendlyError(error, kind, trimmed) };
}

export async function deleteCurriculumNode(kind: CurriculumKind, id: string) {
  const gate = await requireCurriculumWrite();
  if (gate.error) return { error: gate.error };
  // Empty-node only — see admin_delete_curriculum_node (no subtree/question wipe).
  const { error } = await gate.supabase.rpc("admin_delete_curriculum_node", {
    p_kind: kind,
    p_id: id,
  });
  revalidatePath("/admin/curriculum");
  return actionRpcResult("deleteCurriculumNode", error);
}
