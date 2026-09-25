"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import { STUDY_REVALIDATE_PATHS } from "@/lib/library/types";

function revalidateStudy() {
  for (const path of STUDY_REVALIDATE_PATHS) revalidatePath(path);
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
