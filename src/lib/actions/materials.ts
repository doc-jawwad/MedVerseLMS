"use server";

import {
  actionRpcResult,
  isSafeBusinessErrorCode,
  logServerError,
} from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { moveContentToBin } from "@/lib/actions/content-bin";
import { STUDY_REVALIDATE_PATHS } from "@/lib/library/types";
import {
  notesPdfMoveErrorMessage,
  notesPdfMoveRevalidatePaths,
} from "@/lib/admin/notes-pdf-move";

function validDriveUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function revalidateStudyPaths() {
  for (const path of STUDY_REVALIDATE_PATHS) revalidatePath(path);
  revalidatePath("/admin/bin");
}

export async function addFolder(
  yearId: string | null,
  subjectId: string | null,
  name: string,
  libraryType: string,
  entitlement: "free" | "any_subscription" = "any_subscription",
  opts?: {
    parentId?: string | null;
    description?: string | null;
    sortOrder?: number;
  }
) {
  if (!name.trim()) return { error: "Folder name required." };
  if (libraryType === "career_counseling_series") {
    if (yearId != null) {
      return { error: "Career Counseling Series folders are universal (no class)." };
    }
  } else if (!yearId) {
    return { error: "Class year is required for this folder type." };
  }
  if (
    (libraryType === "notes" ||
      libraryType === "syllabus" ||
      libraryType === "one_liner") &&
    !subjectId
  ) {
    return {
      error: "Subject is required for Notes, Syllabus, and One Liner folders.",
    };
  }
  if (libraryType === "one_liner" && opts?.parentId) {
    return { error: "One Liner does not support nested folders yet." };
  }
  const supabase = await createClient();
  // protect_resource_entitlement allows INSERT only as free; paid/plan must
  // go through set_resource_entitlement after the row exists.
  const { data: folder, error } = await supabase
    .from("material_folders")
    .insert({
      year_id: libraryType === "career_counseling_series" ? null : yearId,
      subject_id: subjectId,
      name: name.trim(),
      library_type: libraryType,
      // Materials admin is the academic library surface. Prof. Session folders
      // are created via prof-session actions with content_surface='prof_session'.
      content_surface: "academic",
      entitlement: "free",
      parent_id: opts?.parentId || null,
      description: opts?.description?.trim() || null,
      sort_order: opts?.sortOrder ?? 0,
    })
    .select("id")
    .single();
  if (error || !folder?.id) {
    revalidateStudyPaths();
    return actionRpcResult(
      "addFolder.insert",
      error ?? { message: "folder_create_failed" }
    );
  }

  if (entitlement !== "free") {
    const { error: entError } = await supabase.rpc("set_resource_entitlement", {
      p_kind: "materials_folder",
      p_id: folder.id,
      p_entitlement: entitlement,
      p_required_plan_id: null,
    });
    if (entError) {
      await supabase.from("material_folders").delete().eq("id", folder.id);
      revalidateStudyPaths();
      return actionRpcResult("addFolder.entitlement", entError);
    }
  }

  revalidateStudyPaths();
  return { id: folder.id };
}

export async function updateFolder(
  folderId: string,
  patch: {
    name?: string;
    description?: string | null;
    sortOrder?: number;
  }
) {
  if (patch.name !== undefined && !patch.name.trim()) {
    return { error: "Folder name required." };
  }
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.description !== undefined) {
    row.description = patch.description?.trim() || null;
  }
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (Object.keys(row).length === 0) return {};
  const { error } = await supabase
    .from("material_folders")
    .update(row)
    .eq("id", folderId);
  revalidateStudyPaths();
  return actionRpcResult("updateFolder", error);
}

export async function reorderFolders(
  orderedIds: string[]
): Promise<{ error?: string }> {
  if (orderedIds.length === 0) return {};
  const supabase = await createClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("material_folders")
      .update({ sort_order: i })
      .eq("id", orderedIds[i]);
    if (error) {
      revalidateStudyPaths();
      return actionRpcResult("reorderFolders", error);
    }
  }
  revalidateStudyPaths();
  return {};
}

export async function deleteFolder(folderId: string) {
  const result = await moveContentToBin("material_folder", folderId);
  revalidateStudyPaths();
  return result;
}

export async function addMaterial(
  folderId: string,
  title: string,
  driveUrl: string,
  description: string,
  fileType: string
) {
  if (!title.trim()) return { error: "Title required." };
  if (!validDriveUrl(driveUrl)) return { error: "Enter a valid https:// link." };
  const supabase = await createClient();
  const { error } = await supabase.from("materials").insert({
    folder_id: folderId,
    title: title.trim(),
    drive_url: driveUrl.trim(),
    description: description.trim(),
    file_type: fileType,
    kind: "drive",
  });
  revalidateStudyPaths();
  return actionRpcResult("action", error);
}

export async function openMaterial(materialId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_material", {
    p_material_id: materialId,
  });
  if (error) return actionRpcResult("action", error);
  if (typeof data !== "string" || !data) {
    return { error: "Unable to open this material." };
  }
  return { url: data };
}

export async function updateMaterial(
  materialId: string,
  patch: {
    title?: string;
    description?: string | null;
  }
) {
  if (patch.title !== undefined && !patch.title.trim()) {
    return { error: "Title required." };
  }
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.description !== undefined) {
    row.description = patch.description?.trim() || null;
  }
  if (Object.keys(row).length === 0) return {};
  const { error } = await supabase
    .from("materials")
    .update(row)
    .eq("id", materialId);
  revalidateStudyPaths();
  return actionRpcResult("updateMaterial", error);
}

export async function deleteMaterial(materialId: string) {
  const result = await moveContentToBin("material", materialId);
  revalidateStudyPaths();
  return result;
}

export type MoveNotesPdfMaterialResult = {
  material_id: string;
  folder_id: string;
  source_folder_id: string;
  r2_object_key: string | null;
  deleted_at: string | null;
};

/** Move a live Notes PDF to another live Notes folder. Preserves id + R2 key. */
export async function moveNotesPdfMaterial(input: {
  materialId: string;
  destFolderId: string;
  sourceFolderId?: string | null;
}) {
  if (!input.materialId || !input.destFolderId) {
    return { error: "Material and destination folder required." };
  }
  if (input.sourceFolderId && input.sourceFolderId === input.destFolderId) {
    return { error: "Choose a different folder." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_move_notes_pdf_material", {
    p_material_id: input.materialId,
    p_dest_folder_id: input.destFolderId,
  });
  for (const path of notesPdfMoveRevalidatePaths({
    sourceFolderId: input.sourceFolderId,
    destFolderId: input.destFolderId,
  })) {
    revalidatePath(path);
  }
  if (error) {
    const raw = (error.message ?? "").trim().toLowerCase();
    if (raw && isSafeBusinessErrorCode(raw)) {
      logServerError("moveNotesPdfMaterial", raw);
      return { error: notesPdfMoveErrorMessage(raw) };
    }
    return actionRpcResult("moveNotesPdfMaterial", error);
  }
  return { result: data as MoveNotesPdfMaterialResult };
}
