/** Pure helpers for Notes PDF Move destinations + cache paths. */

export type NotesPdfMoveDestination = {
  id: string;
  name: string;
  year_id: string;
  library_type: string;
  content_surface: string;
  subject_id?: string | null;
};

/** Drop the current folder so Move never offers a no-op same destination. */
export function filterNotesPdfMoveDestinations(
  destinations: NotesPdfMoveDestination[],
  opts: {
    sourceFolderId: string;
    yearId: string;
    contentSurface?: string | null;
  }
): NotesPdfMoveDestination[] {
  const surface = opts.contentSurface ?? "academic";
  return destinations.filter(
    (d) =>
      d.id !== opts.sourceFolderId &&
      d.library_type === "notes" &&
      d.year_id === opts.yearId &&
      (d.content_surface || "academic") === surface
  );
}

export function notesPdfMoveDestinationLabel(d: NotesPdfMoveDestination): string {
  return d.name;
}

/**
 * Admin + student paths that must refresh after a Notes PDF Move.
 * Does not call revalidatePath — server actions own that.
 */
export function notesPdfMoveRevalidatePaths(input: {
  sourceFolderId?: string | null;
  destFolderId?: string | null;
}): string[] {
  const paths = [
    "/admin/materials",
    "/admin/free-resources",
    "/admin/library",
    "/admin/bin",
    "/notes",
    "/free-resources",
    "/free-resources/notes",
    "/library",
    "/academic",
    "/materials",
    "/resources",
  ];
  // Folder-scoped admin deep links are query-driven today; keep listing roots.
  void input.sourceFolderId;
  void input.destFolderId;
  return [...new Set(paths)];
}

/** Map RPC business codes to short admin-facing copy. */
export function notesPdfMoveErrorMessage(code: string): string {
  switch (code) {
    case "permission_denied":
      return "You need Manage materials permission to move Notes PDFs.";
    case "year_scope_denied":
      return "You do not have access to this class year.";
    case "notes_move_year_mismatch":
      return "Destination folder must be in the same class year.";
    case "notes_move_library_type_mismatch":
    case "notes_move_source_not_notes":
      return "Destination must be a Notes folder.";
    case "notes_move_content_surface_mismatch":
      return "Destination must match the Notes surface (Academic vs Prof. Session).";
    case "destination_folder_deleted":
    case "source_folder_deleted":
      return "That folder is in the Bin and cannot be used.";
    case "material_deleted":
      return "This PDF is in the Bin and cannot be moved.";
    case "same_folder":
      return "Choose a different folder.";
    case "notes_move_pdf_only":
      return "Only PDF materials can be moved this way.";
    case "material_not_found":
    case "destination_folder_not_found":
    case "source_folder_not_found":
      return "Material or folder not found.";
    case "not_authenticated":
      return "Sign in again to continue.";
    default:
      return code;
  }
}
