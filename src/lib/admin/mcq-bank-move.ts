/** Pure helpers for Academic MCQ Bank Move destinations + cache paths. */

export type McqMoveDestination = {
  subfolder_id: string;
  name: string;
  folder_id: string;
  folder_name: string;
};

/** Label shown in Move destination selectors. */
export function mcqMoveDestinationLabel(d: McqMoveDestination): string {
  return `${d.folder_name} / ${d.name}`;
}

/** Drop the current subfolder so Move never offers a no-op same destination. */
export function filterMcqMoveDestinations(
  destinations: McqMoveDestination[],
  opts?: { excludeSubfolderId?: string | null }
): McqMoveDestination[] {
  const exclude = opts?.excludeSubfolderId ?? null;
  if (!exclude) return destinations;
  return destinations.filter((d) => d.subfolder_id !== exclude);
}

/**
 * Admin paths that must refresh after a Move (source + dest folder/subfolder).
 * Does not call revalidatePath — server actions own that.
 */
export function mcqBankMoveRevalidatePaths(input: {
  productKey?: string | null;
  folderIds?: Array<string | null | undefined>;
  subfolders?: Array<{
    folderId: string | null | undefined;
    subfolderId: string | null | undefined;
  }>;
}): string[] {
  const paths = [
    "/admin/mcq-bank",
    "/admin/mcq-bank/classify",
    "/admin/bin",
    "/admin/questions",
    "/academic",
  ];
  const productKey = input.productKey?.trim();
  if (!productKey) return paths;

  paths.push(`/admin/mcq-bank/${productKey}`);

  const folderIds = new Set<string>();
  for (const id of input.folderIds ?? []) {
    if (id) folderIds.add(id);
  }
  for (const s of input.subfolders ?? []) {
    if (s.folderId) folderIds.add(s.folderId);
  }
  for (const folderId of folderIds) {
    paths.push(`/admin/mcq-bank/${productKey}/${folderId}`);
  }
  for (const s of input.subfolders ?? []) {
    if (s.folderId && s.subfolderId) {
      paths.push(
        `/admin/mcq-bank/${productKey}/${s.folderId}/${s.subfolderId}`
      );
    }
  }
  return [...new Set(paths)];
}
