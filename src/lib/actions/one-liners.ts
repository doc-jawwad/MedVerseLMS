"use server";

import { revalidatePath } from "next/cache";
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

export type OneLinerInput = {
  year_id: string;
  subject_id: string;
  title: string;
  body: string;
  status?: "draft" | "published";
};

function reval(id?: string) {
  revalidatePath("/admin/one-liners");
  revalidatePath("/admin/prof-session");
  revalidatePath("/academic");
  if (id) revalidatePath(`/admin/one-liners/${id}`);
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

export async function createOneLiner(input: OneLinerInput) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_one_liner", {
    p_year_id: input.year_id,
    p_subject_id: input.subject_id,
    p_title: input.title,
    p_body: input.body,
    p_status: input.status ?? "draft",
  });
  reval(typeof data === "string" ? data : undefined);
  if (error) return actionRpcResult("createOneLiner", error);
  return { id: data as string };
}

export async function updateOneLiner(
  id: string,
  input: Partial<OneLinerInput>
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_one_liner", {
    p_id: id,
    p_title: input.title ?? null,
    p_body: input.body ?? null,
    p_subject_id: input.subject_id ?? null,
    p_status: input.status ?? null,
  });
  reval(id);
  return actionRpcResult("updateOneLiner", error);
}

export async function setOneLinerStatus(id: string, status: "draft" | "published") {
  return updateOneLiner(id, { status });
}

export async function moveOneLinerToBin(id: string) {
  return moveContentToBin("one_liner", id);
}

/** Optional private PDF source for a Prof. Session one-liner (study-content/ R2). */
export async function attachOneLinerSourcePdf(
  oneLinerId: string,
  formData: FormData
) {
  if (!oneLinerId) return { error: "Invalid one-liner." };
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "pdf_empty" };
  }
  const metaErr = isStudyPdfMeta(file);
  if (metaErr) return { error: metaErr };

  const supabase = await createClient();
  const { data: adminRow, error: loadErr } = await supabase.rpc(
    "get_one_liner_for_admin",
    { p_one_liner_id: oneLinerId }
  );
  if (loadErr || !adminRow) {
    return actionRpcResult("attachOneLinerSourcePdf.load", loadErr);
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
    return clientActionFailed("attachOneLinerSourcePdf.put", uploaded.error);
  }

  const previousKey =
    typeof existing.r2_object_key === "string" ? existing.r2_object_key : null;

  const { error } = await supabase
    .from("one_liners")
    .update({
      r2_object_key: key,
      r2_content_type: STUDY_PDF_CONTENT_TYPE,
      r2_byte_size: file.size,
    })
    .eq("id", oneLinerId);

  if (error) {
    await discardStudyKey(supabase, key);
    return {
      error: toClientActionError(error, "attachOneLinerSourcePdf.update"),
    };
  }

  if (previousKey && previousKey !== key) {
    await discardStudyKey(supabase, previousKey);
  }

  reval(oneLinerId);
  return {};
}

export async function clearOneLinerSourcePdf(oneLinerId: string) {
  if (!oneLinerId) return { error: "Invalid one-liner." };
  const supabase = await createClient();
  const { data: adminRow, error: loadErr } = await supabase.rpc(
    "get_one_liner_for_admin",
    { p_one_liner_id: oneLinerId }
  );
  if (loadErr || !adminRow) {
    return actionRpcResult("clearOneLinerSourcePdf.load", loadErr);
  }
  const existing = adminRow as { r2_object_key?: string | null };
  const previousKey =
    typeof existing.r2_object_key === "string" ? existing.r2_object_key : null;

  const { error } = await supabase
    .from("one_liners")
    .update({
      r2_object_key: null,
      r2_content_type: null,
      r2_byte_size: null,
    })
    .eq("id", oneLinerId);
  if (error) {
    return {
      error: toClientActionError(error, "clearOneLinerSourcePdf.update"),
    };
  }
  if (previousKey) await discardStudyKey(supabase, previousKey);
  reval(oneLinerId);
  return {};
}
