"use server";

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

export async function addFolder(yearId: string, subjectId: string | null, name: string) {
  if (!name.trim()) return { error: "Folder name required." };
  const supabase = await createClient();
  const { error } = await supabase.from("material_folders").insert({
    year_id: yearId,
    subject_id: subjectId,
    name: name.trim(),
  });
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { error: error?.message };
}

export async function deleteFolder(folderId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_folders")
    .delete()
    .eq("id", folderId);
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { error: error?.message };
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
  return { error: error?.message };
}

export async function deleteMaterial(materialId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("materials").delete().eq("id", materialId);
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { error: error?.message };
}
