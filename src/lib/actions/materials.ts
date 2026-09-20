"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function validDriveUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function addFolder(
  yearId: string,
  subjectId: string | null,
  name: string,
  libraryType: string,
  entitlement: "free" | "any_subscription" = "any_subscription"
) {
  if (!name.trim()) return { error: "Folder name required." };
  const supabase = await createClient();
  // protect_resource_entitlement allows INSERT only as free; paid/plan must
  // go through set_resource_entitlement after the row exists.
  const { data: folder, error } = await supabase
    .from("material_folders")
    .insert({
      year_id: yearId,
      subject_id: subjectId,
      name: name.trim(),
      library_type: libraryType,
      entitlement: "free",
    })
    .select("id")
    .single();
  if (error || !folder?.id) {
    revalidateStudyPaths();
    return actionRpcResult("addFolder.insert", error ?? { message: "folder_create_failed" });
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
  return {};
}

function revalidateStudyPaths() {
  revalidatePath("/admin/materials");
  revalidatePath("/admin/free-resources");
  revalidatePath("/admin/library");
  revalidatePath("/materials");
  revalidatePath("/free-resources");
}

export async function deleteFolder(folderId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_folders")
    .delete()
    .eq("id", folderId);
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return actionRpcResult("action", error);
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
  });
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
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

export async function deleteMaterial(materialId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", materialId);
  revalidatePath("/admin/materials");
  revalidatePath("/admin/free-resources");
  revalidatePath("/materials");
  revalidatePath("/free-resources");
  return actionRpcResult("action", error);
}
