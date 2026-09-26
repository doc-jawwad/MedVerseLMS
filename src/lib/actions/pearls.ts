"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readAdminSelectedYearId } from "@/lib/admin/selected-class";
import {
  actionRpcResult,
  clientActionFailed,
  toClientActionError,
} from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import { moveContentToBin } from "@/lib/actions/content-bin";
import { allocateStudyObjectKey } from "@/lib/actions/study-content";
import { deleteR2Object, putR2Object } from "@/lib/r2/presign";
import {
  isStudyPdfMeta,
  STUDY_PDF_CONTENT_TYPE,
} from "@/lib/study/upload-rules";

function revalidatePearls(id?: string) {
  revalidatePath("/admin/pearls");
  revalidatePath("/admin/free-resources");
  revalidatePath("/admin/library");
  revalidatePath("/admin/bin");
  revalidatePath("/one-liner");
  revalidatePath("/pearl-points");
  revalidatePath("/free-resources");
  revalidatePath("/free-resources/one-liner");
  revalidatePath("/free-resources/pearl-points");
  revalidatePath("/academic");
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
    return { error: "Select a class before creating a One Liner." };
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
  revalidatePearls(data.id);
  return { id: data.id as string };
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
  const result = await moveContentToBin("pearl_point", id);
  if (result.error) return result;
  revalidatePearls();
  redirect("/admin/pearls");
}

export async function openPearl(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_pearl", { p_pearl_id: id });
  if (error) return actionRpcResult("openPearl", error);
  return { pearl: data as Record<string, unknown> };
}

async function discardStudyKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: string
) {
  const { error } = await supabase.rpc("authorize_study_object_discard", {
    p_object_key: key,
  });
  if (error) return;
  await deleteR2Object({ key });
}

/** Optional private PDF source for a One Liner (study-content/ R2). */
export async function attachPearlSourcePdf(pearlId: string, formData: FormData) {
  if (!pearlId) return { error: "Invalid One Liner." };
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "pdf_empty" };
  }
  const metaErr = isStudyPdfMeta(file);
  if (metaErr) return { error: metaErr };

  const supabase = await createClient();
  const { data: adminRow, error: loadErr } = await supabase.rpc(
    "get_pearl_for_admin",
    { p_pearl_id: pearlId }
  );
  if (loadErr || !adminRow) {
    return actionRpcResult("attachPearlSourcePdf.load", loadErr);
  }
  const existing = adminRow as { r2_object_key?: string | null };

  const allocated = await allocateStudyObjectKey();
  if ("error" in allocated && allocated.error) return allocated;
  if (!("key" in allocated)) return { error: "study_object_denied" };
  const key = allocated.key;

  const uploaded = await putR2Object({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: STUDY_PDF_CONTENT_TYPE,
  });
  if (uploaded.error) {
    await discardStudyKey(supabase, key);
    return clientActionFailed("attachPearlSourcePdf.put", uploaded.error);
  }

  const previousKey =
    typeof existing.r2_object_key === "string" ? existing.r2_object_key : null;

  const { error } = await supabase
    .from("pearl_points")
    .update({
      r2_object_key: key,
      r2_content_type: STUDY_PDF_CONTENT_TYPE,
      r2_byte_size: file.size,
    })
    .eq("id", pearlId);

  if (error) {
    await discardStudyKey(supabase, key);
    return { error: toClientActionError(error, "attachPearlSourcePdf.update") };
  }

  if (previousKey && previousKey !== key) {
    await discardStudyKey(supabase, previousKey);
  }

  revalidatePearls(pearlId);
  return {};
}

export async function clearPearlSourcePdf(pearlId: string) {
  if (!pearlId) return { error: "Invalid One Liner." };
  const supabase = await createClient();
  const { data: adminRow, error: loadErr } = await supabase.rpc(
    "get_pearl_for_admin",
    { p_pearl_id: pearlId }
  );
  if (loadErr || !adminRow) {
    return actionRpcResult("clearPearlSourcePdf.load", loadErr);
  }
  const existing = adminRow as { r2_object_key?: string | null };
  const previousKey =
    typeof existing.r2_object_key === "string" ? existing.r2_object_key : null;

  const { error } = await supabase
    .from("pearl_points")
    .update({
      r2_object_key: null,
      r2_content_type: null,
      r2_byte_size: null,
    })
    .eq("id", pearlId);
  if (error) {
    return { error: toClientActionError(error, "clearPearlSourcePdf.update") };
  }
  if (previousKey) await discardStudyKey(supabase, previousKey);
  revalidatePearls(pearlId);
  return {};
}
