"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";

/** Explicit folder Restart — done→remaining for this folder only. */
export async function restartMcqBankFolderPractice(folderId: string) {
  if (!folderId) return { error: "Folder required." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_mcq_bank_folder_practice", {
    p_folder_id: folderId,
  });
  revalidatePath("/academic");
  revalidatePath("/mcq-bank");
  revalidatePath("/practice");
  if (error) return actionRpcResult("restartMcqBankFolderPractice", error);
  return {
    result: data as { folder_id: string; reset_count: number },
  };
}
