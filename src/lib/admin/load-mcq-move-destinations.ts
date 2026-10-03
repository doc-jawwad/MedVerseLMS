import "server-only";

import type { McqMoveDestination } from "@/lib/admin/mcq-bank-move";

/** Minimal client shape — Supabase rpc() returns a thenable builder. */
type RpcClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

/**
 * Product/year-scoped live subfolders for Move destinations.
 * Uses existing list RPCs + folder list (live rows only).
 */
export async function loadMcqMoveDestinations(
  supabase: RpcClient,
  productSubjectId: string
): Promise<McqMoveDestination[]> {
  const { data: folderRows, error } = await supabase.rpc(
    "admin_list_mcq_bank_folders",
    { p_product_subject_id: productSubjectId }
  );
  if (error) throw error;

  const folders = (folderRows ?? []) as Array<{
    folder_id: string;
    name: string;
  }>;

  const lists = await Promise.all(
    folders.map(async (folder) => {
      const { data, error: subErr } = await supabase.rpc(
        "admin_list_mcq_bank_subfolders",
        { p_folder_id: folder.folder_id }
      );
      if (subErr) throw subErr;
      return (
        (data ?? []) as Array<{ subfolder_id: string; name: string }>
      ).map(
        (s): McqMoveDestination => ({
          subfolder_id: s.subfolder_id,
          name: s.name,
          folder_id: folder.folder_id,
          folder_name: folder.name,
        })
      );
    })
  );

  return lists.flat().sort((a, b) => {
    const folderCmp = a.folder_name.localeCompare(b.folder_name);
    if (folderCmp !== 0) return folderCmp;
    return a.name.localeCompare(b.name);
  });
}
