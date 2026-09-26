"use server";

import { revalidatePath } from "next/cache";
import {
  actionRpcResult,
  clientActionFailed,
  toClientActionError,
} from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import { deleteR2Object, putR2Object } from "@/lib/r2/presign";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  getR2ObjectRange,
  headR2Object,
  presignR2Upload,
} from "@/lib/r2/multipart";
import {
  chooseStudyPdfParting,
  openStudyPdfUploadSession,
  sealStudyPdfUploadSession,
  STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS,
  type StudyPdfUploadSessionPayload,
} from "@/lib/study/upload-session";
import {
  isStudyCoverFile,
  isStudyPdfMeta,
  STUDY_PDF_CONTENT_TYPE,
} from "@/lib/study/upload-rules";
import { STUDY_REVALIDATE_PATHS } from "@/lib/library/types";

function revalidateStudy() {
  for (const path of STUDY_REVALIDATE_PATHS) revalidatePath(path);
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

async function requireAdminFolder(folderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not_authenticated" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    return { error: "permission_denied" as const };
  }

  const { data: folder, error } = await supabase
    .from("material_folders")
    .select("id, year_id, library_type, deleted_at")
    .eq("id", folderId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return actionRpcResult("requireAdminFolder", error);
  if (!folder) return { error: "folder_not_found" as const };

  return { supabase, user, folder };
}

export async function beginStudyPdfUpload(input: {
  folderId: string;
  fileName: string;
  byteSize: number;
  contentType: string;
}) {
  if (!input.folderId) return { error: "Title and folder are required." };
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { error: "Choose a PDF file." };
  }
  const metaErr = isStudyPdfMeta({
    type: input.contentType,
    size: input.byteSize,
    name: input.fileName,
  });
  if (metaErr) return { error: metaErr };

  const gate = await requireAdminFolder(input.folderId);
  if ("error" in gate && gate.error) return { error: gate.error };
  if (!("supabase" in gate)) return { error: "permission_denied" };
  const { supabase, user } = gate;

  const { data: key, error: allocError } = await supabase.rpc(
    "allocate_study_object_key",
    { p_folder_id: input.folderId }
  );
  if (allocError) return actionRpcResult("beginStudyPdfUpload.alloc", allocError);
  if (typeof key !== "string" || !key) return { error: "study_object_denied" };

  const parting = chooseStudyPdfParting(input.byteSize);
  const exp =
    Math.floor(Date.now() / 1000) + STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS;

  if (parting.mode === "put") {
    const signed = presignR2Upload({
      method: "PUT",
      key,
      contentType: STUDY_PDF_CONTENT_TYPE,
      expiresSeconds: STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS,
    });
    if ("error" in signed) {
      await discardStudyKey(supabase, key);
      return clientActionFailed("beginStudyPdfUpload.putSign", signed.error);
    }
    const sealed = sealStudyPdfUploadSession({
      v: 1,
      key,
      uploadId: null,
      folderId: input.folderId,
      mode: "put",
      declaredSize: input.byteSize,
      contentType: STUDY_PDF_CONTENT_TYPE,
      uid: user.id,
      partSize: parting.partSize,
      partCount: 1,
      exp,
    });
    if ("error" in sealed) {
      await discardStudyKey(supabase, key);
      return sealed;
    }
    return {
      mode: "put" as const,
      sessionToken: sealed.token,
      key,
      putUrl: signed.url,
      contentType: STUDY_PDF_CONTENT_TYPE,
      expiresSeconds: STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS,
      declaredSize: input.byteSize,
    };
  }

  const created = await createMultipartUpload({
    key,
    contentType: STUDY_PDF_CONTENT_TYPE,
  });
  if ("error" in created) {
    await discardStudyKey(supabase, key);
    return clientActionFailed("beginStudyPdfUpload.multipart", created.error);
  }

  const sealed = sealStudyPdfUploadSession({
    v: 1,
    key,
    uploadId: created.uploadId,
    folderId: input.folderId,
    mode: "multipart",
    declaredSize: input.byteSize,
    contentType: STUDY_PDF_CONTENT_TYPE,
    uid: user.id,
    partSize: parting.partSize,
    partCount: parting.partCount,
    exp,
  });
  if ("error" in sealed) {
    await abortMultipartUpload({ key, uploadId: created.uploadId });
    await discardStudyKey(supabase, key);
    return sealed;
  }

  return {
    mode: "multipart" as const,
    sessionToken: sealed.token,
    key,
    uploadId: created.uploadId,
    partSize: parting.partSize,
    partCount: parting.partCount,
    contentType: STUDY_PDF_CONTENT_TYPE,
    expiresSeconds: STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS,
    declaredSize: input.byteSize,
  };
}

export async function signStudyPdfUploadParts(input: {
  sessionToken: string;
  partNumbers: number[];
}) {
  const session = openStudyPdfUploadSession(input.sessionToken);
  if ("error" in session) return session;
  if (session.mode !== "multipart" || !session.uploadId) {
    return { error: "upload_session_invalid" };
  }

  const gate = await requireAdminFolder(session.folderId);
  if ("error" in gate && gate.error) return { error: gate.error };
  if (!("user" in gate) || gate.user.id !== session.uid) {
    return { error: "permission_denied" };
  }

  const nums = [...new Set(input.partNumbers)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= session.partCount)
    .sort((a, b) => a - b);
  if (nums.length === 0) return { error: "upload_parts_required" };
  if (nums.length > 50) return { error: "upload_parts_batch_too_large" };

  const urls: Array<{ partNumber: number; url: string }> = [];
  for (const partNumber of nums) {
    const signed = presignR2Upload({
      method: "PUT",
      key: session.key,
      query: {
        partNumber: String(partNumber),
        uploadId: session.uploadId,
      },
      expiresSeconds: Math.min(
        STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS,
        Math.max(60, session.exp - Math.floor(Date.now() / 1000))
      ),
    });
    if ("error" in signed) {
      return clientActionFailed("signStudyPdfUploadParts", signed.error);
    }
    urls.push({ partNumber, url: signed.url });
  }
  return { urls };
}

async function verifyPdfObject(
  session: StudyPdfUploadSessionPayload
): Promise<{ error?: string }> {
  const head = await headR2Object({ key: session.key });
  if ("error" in head) return head;
  if (head.contentLength !== session.declaredSize) {
    return { error: "pdf_size_mismatch" };
  }
  const ct = (head.contentType || "").toLowerCase();
  if (
    ct &&
    !ct.includes("pdf") &&
    ct !== "application/octet-stream" &&
    ct !== "binary/octet-stream"
  ) {
    return { error: "pdf_type_invalid" };
  }
  const range = await getR2ObjectRange({
    key: session.key,
    start: 0,
    end: 7,
  });
  if ("error" in range) return range;
  const magic = range.body.toString("utf8");
  if (!magic.startsWith("%PDF-")) {
    return { error: "pdf_magic_invalid" };
  }
  return {};
}

export async function completeStudyPdfUpload(input: {
  sessionToken: string;
  title: string;
  description?: string;
  chapterId?: string | null;
  topicId?: string | null;
  referenceText?: string;
  publish?: boolean;
  /** Multipart only — ETags from R2 UploadPart responses. */
  parts?: Array<{ partNumber: number; etag: string }>;
  /** Optional small cover — still server-proxied (≤2MB). */
  cover?: File | null;
}) {
  const title = input.title.trim();
  if (!title) return { error: "Title and folder are required." };

  const session = openStudyPdfUploadSession(input.sessionToken);
  if ("error" in session) return session;

  const gate = await requireAdminFolder(session.folderId);
  if ("error" in gate && gate.error) return { error: gate.error };
  if (!("supabase" in gate) || !("user" in gate)) {
    return { error: "permission_denied" };
  }
  if (gate.user.id !== session.uid) return { error: "permission_denied" };
  const { supabase } = gate;

  try {
    if (session.mode === "multipart") {
      if (!session.uploadId) return { error: "upload_session_invalid" };
      const parts = input.parts ?? [];
      if (parts.length !== session.partCount) {
        return { error: "upload_parts_incomplete" };
      }
      const completed = await completeMultipartUpload({
        key: session.key,
        uploadId: session.uploadId,
        parts,
      });
      if (completed.error) {
        return clientActionFailed(
          "completeStudyPdfUpload.complete",
          completed.error
        );
      }
    }

    const verified = await verifyPdfObject(session);
    if (verified.error) {
      await cleanupFailedUpload(supabase, session);
      return { error: verified.error };
    }

    let coverKey: string | null = null;
    if (input.cover instanceof File && input.cover.size > 0) {
      const coverErr = isStudyCoverFile(input.cover);
      if (coverErr) {
        await cleanupFailedUpload(supabase, session);
        return { error: coverErr };
      }
      const { data: cKey, error: cAlloc } = await supabase.rpc(
        "allocate_study_object_key",
        { p_folder_id: session.folderId }
      );
      if (cAlloc || typeof cKey !== "string") {
        await cleanupFailedUpload(supabase, session);
        return { error: "study_object_denied" };
      }
      coverKey = cKey;
      const coverPut = await putR2Object({
        key: coverKey,
        body: Buffer.from(await input.cover.arrayBuffer()),
        contentType: input.cover.type,
      });
      if (coverPut.error) {
        await discardStudyKey(supabase, coverKey);
        await cleanupFailedUpload(supabase, session);
        return clientActionFailed("completeStudyPdfUpload.cover", coverPut.error);
      }
    }

    const { error } = await supabase.from("materials").insert({
      folder_id: session.folderId,
      title,
      description: (input.description ?? "").trim(),
      file_type: "pdf",
      kind: "pdf",
      status: input.publish ? "published" : "draft",
      r2_object_key: session.key,
      r2_content_type: STUDY_PDF_CONTENT_TYPE,
      r2_byte_size: session.declaredSize,
      cover_object_key: coverKey,
      chapter_id: input.chapterId || null,
      topic_id: input.topicId || null,
      reference_text: (input.referenceText ?? "").trim(),
    });
    if (error) {
      if (coverKey) await discardStudyKey(supabase, coverKey);
      await cleanupFailedUpload(supabase, session);
      return { error: toClientActionError(error, "completeStudyPdfUpload.insert") };
    }
    revalidateStudy();
    return { ok: true as const, key: session.key, byteSize: session.declaredSize };
  } catch (e) {
    await cleanupFailedUpload(supabase, session);
    return clientActionFailed(
      "completeStudyPdfUpload",
      e instanceof Error ? e.message : "upload_failed"
    );
  }
}

export async function abortStudyPdfUpload(input: { sessionToken: string }) {
  const session = openStudyPdfUploadSession(input.sessionToken);
  if ("error" in session) return session;

  const gate = await requireAdminFolder(session.folderId);
  if ("error" in gate && gate.error) return { error: gate.error };
  if (!("supabase" in gate) || !("user" in gate)) {
    return { error: "permission_denied" };
  }
  if (gate.user.id !== session.uid) return { error: "permission_denied" };

  await cleanupFailedUpload(gate.supabase, session);
  return { ok: true as const };
}

async function cleanupFailedUpload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: StudyPdfUploadSessionPayload
) {
  if (session.mode === "multipart" && session.uploadId) {
    await abortMultipartUpload({
      key: session.key,
      uploadId: session.uploadId,
    });
  }
  await discardStudyKey(supabase, session.key);
}
