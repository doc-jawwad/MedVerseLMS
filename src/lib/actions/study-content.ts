"use server";

import { revalidatePath } from "next/cache";
import {
  actionRpcResult,
  clientActionFailed,
  toClientActionError,
} from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import {
  deleteR2Object,
  putR2Object,
} from "@/lib/r2/presign";
import { isStudyCoverFile, isStudyPdfFile } from "@/lib/study/upload-rules";
import { STUDY_REVALIDATE_PATHS } from "@/lib/library/types";

function revalidateStudy() {
  for (const path of STUDY_REVALIDATE_PATHS) revalidatePath(path);
}

async function discardStudyKey(supabase: Awaited<ReturnType<typeof createClient>>, key: string) {
  const { error } = await supabase.rpc("authorize_study_object_discard", {
    p_object_key: key,
  });
  if (error) return;
  await deleteR2Object({ key });
}

export async function allocateStudyObjectKey() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_study_object_key");
  if (error) return actionRpcResult("allocateStudyObjectKey", error);
  if (typeof data !== "string" || !data) {
    return { error: "study_object_denied" };
  }
  return { key: data };
}

export async function addPdfMaterial(formData: FormData) {
  const folderId = String(formData.get("folderId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const chapterId = String(formData.get("chapterId") ?? "") || null;
  const topicId = String(formData.get("topicId") ?? "") || null;
  const referenceText = String(formData.get("referenceText") ?? "").trim();
  const publish = String(formData.get("publish") ?? "") === "1";
  const file = formData.get("file");
  const cover = formData.get("cover");

  if (!folderId || !title) return { error: "Title and folder are required." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a PDF file." };
  }
  const pdfErr = isStudyPdfFile(file);
  if (pdfErr) return { error: pdfErr };

  let coverErr: string | null = null;
  if (cover instanceof File && cover.size > 0) {
    coverErr = isStudyCoverFile(cover);
    if (coverErr) return { error: coverErr };
  }

  const supabase = await createClient();
  const allocated = await allocateStudyObjectKey();
  if ("error" in allocated && allocated.error) return allocated;
  if (!("key" in allocated)) return { error: "study_object_denied" };
  const key = allocated.key;

  const uploaded = await putR2Object({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || "application/pdf",
  });
  if (uploaded.error) {
    await discardStudyKey(supabase, key);
    return clientActionFailed("addPdfMaterial.put", uploaded.error);
  }

  let coverKey: string | null = null;
  if (cover instanceof File && cover.size > 0) {
    const coverAlloc = await allocateStudyObjectKey();
    if ("error" in coverAlloc && coverAlloc.error) {
      await discardStudyKey(supabase, key);
      return coverAlloc;
    }
    if (!("key" in coverAlloc)) {
      await discardStudyKey(supabase, key);
      return { error: "study_object_denied" };
    }
    coverKey = coverAlloc.key;
    const coverPut = await putR2Object({
      key: coverKey,
      body: Buffer.from(await cover.arrayBuffer()),
      contentType: cover.type,
    });
    if (coverPut.error) {
      await discardStudyKey(supabase, key);
      await discardStudyKey(supabase, coverKey);
      return clientActionFailed("addPdfMaterial.cover", coverPut.error);
    }
  }

  const { error } = await supabase.from("materials").insert({
    folder_id: folderId,
    title,
    description,
    file_type: "pdf",
    kind: "pdf",
    status: publish ? "published" : "draft",
    r2_object_key: key,
    r2_content_type: "application/pdf",
    r2_byte_size: file.size,
    cover_object_key: coverKey,
    chapter_id: chapterId,
    topic_id: topicId,
    reference_text: referenceText,
  });
  if (error) {
    await discardStudyKey(supabase, key);
    if (coverKey) await discardStudyKey(supabase, coverKey);
    return { error: toClientActionError(error, "addPdfMaterial.insert") };
  }
  revalidateStudy();
  return {};
}

export async function addGuidelineMaterial(input: {
  folderId: string;
  title: string;
  description?: string;
  bodyText: string;
  chapterId?: string | null;
  topicId?: string | null;
  referenceText?: string;
  publish?: boolean;
}) {
  if (!input.folderId || !input.title.trim()) {
    return { error: "Title and folder are required." };
  }
  if (!input.bodyText.trim()) return { error: "Guideline text is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert({
    folder_id: input.folderId,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    file_type: "guideline",
    kind: "guideline",
    status: input.publish ? "published" : "draft",
    body_text: input.bodyText,
    chapter_id: input.chapterId || null,
    topic_id: input.topicId || null,
    reference_text: (input.referenceText ?? "").trim(),
  });
  revalidateStudy();
  return actionRpcResult("addGuidelineMaterial", error);
}

export async function updateGuidelineMaterial(input: {
  materialId: string;
  title: string;
  description?: string;
  bodyText: string;
  referenceText?: string;
  status?: "draft" | "published";
}) {
  if (!input.title.trim() || !input.bodyText.trim()) {
    return { error: "Title and guideline text are required." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
      body_text: input.bodyText,
      reference_text: (input.referenceText ?? "").trim(),
      status: input.status,
    })
    .eq("id", input.materialId)
    .eq("kind", "guideline");
  revalidateStudy();
  revalidatePath(`/materials/${input.materialId}/read`);
  revalidatePath(`/admin/materials/${input.materialId}`);
  return actionRpcResult("updateGuidelineMaterial", error);
}

export async function setMaterialStatus(
  materialId: string,
  status: "draft" | "published"
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({ status })
    .eq("id", materialId);
  revalidateStudy();
  return actionRpcResult("setMaterialStatus", error);
}

export async function openStudyItem(materialId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_study_item", {
    p_material_id: materialId,
  });
  if (error) return actionRpcResult("openStudyItem", error);
  return { item: data as Record<string, unknown> };
}

export async function getMaterialForAdmin(materialId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_material_for_admin", {
    p_material_id: materialId,
  });
  if (error) return actionRpcResult("getMaterialForAdmin", error);
  return { item: data as Record<string, unknown> };
}
