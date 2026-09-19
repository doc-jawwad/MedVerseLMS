"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readAdminSelectedYearId } from "@/lib/admin/selected-class";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";

function revalidatePearls(id?: string) {
  revalidatePath("/admin/pearls");
  revalidatePath("/admin/free-resources");
  revalidatePath("/admin/library");
  revalidatePath("/pearl-points");
  revalidatePath("/free-resources");
  revalidatePath("/free-resources/pearl-points");
  if (id) revalidatePath(`/admin/pearls/${id}`);
}

export type PearlInput = {
  prompt: string;
  answer: string;
  explanation?: string;
  yearId: string;
  subjectId: string;
  chapterId?: string | null;
  topicId?: string | null;
  status?: "draft" | "published";
};

export async function createPearlPoint(input: PearlInput) {
  const selectedYearId = await readAdminSelectedYearId();
  if (!selectedYearId) {
    return { error: "Select a class before creating a pearl point." };
  }
  if (!input.prompt.trim() || !input.answer.trim() || !input.subjectId) {
    return { error: "Prompt, answer, and subject are required." };
  }
  const supabase = await createClient();
  const { data: subject } = await supabase
    .from("subjects")
    .select("year_id")
    .eq("id", input.subjectId)
    .maybeSingle();
  if (!subject || subject.year_id !== selectedYearId) {
    return { error: "Subject must belong to the selected class." };
  }
  const { data, error } = await supabase
    .from("pearl_points")
    .insert({
      prompt: input.prompt.trim(),
      answer: input.answer.trim(),
      explanation: (input.explanation ?? "").trim(),
      year_id: selectedYearId,
      subject_id: input.subjectId,
      chapter_id: input.chapterId || null,
      topic_id: input.topicId || null,
      status: input.status ?? "draft",
    })
    .select("id")
    .single();
  if (error) return actionRpcResult("createPearlPoint", error);
  revalidatePearls();
  redirect(`/admin/pearls/${data.id}`);
}

export async function updatePearlPoint(id: string, input: PearlInput) {
  if (!input.prompt.trim() || !input.answer.trim()) {
    return { error: "Prompt and answer are required." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("pearl_points")
    .update({
      prompt: input.prompt.trim(),
      answer: input.answer.trim(),
      explanation: (input.explanation ?? "").trim(),
      year_id: input.yearId,
      subject_id: input.subjectId,
      chapter_id: input.chapterId || null,
      topic_id: input.topicId || null,
      status: input.status ?? "draft",
    })
    .eq("id", id);
  revalidatePearls(id);
  return actionRpcResult("updatePearlPoint", error);
}

export async function setPearlStatus(id: string, status: "draft" | "published") {
  const supabase = await createClient();
  const { error } = await supabase
    .from("pearl_points")
    .update({ status })
    .eq("id", id);
  revalidatePearls(id);
  return actionRpcResult("setPearlStatus", error);
}

export async function deletePearlPoint(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("pearl_points").delete().eq("id", id);
  if (error) return actionRpcResult("deletePearlPoint", error);
  revalidatePearls();
  redirect("/admin/pearls");
}

export async function openPearl(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_pearl", { p_pearl_id: id });
  if (error) return actionRpcResult("openPearl", error);
  return { pearl: data as Record<string, unknown> };
}
