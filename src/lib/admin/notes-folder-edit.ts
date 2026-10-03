/** Pure helpers for Notes folder Rename + Change Subject. */

export type NotesFolderSubjectOption = {
  id: string;
  name: string;
  year_id: string;
};

export function filterNotesFolderSubjects(
  subjects: NotesFolderSubjectOption[],
  opts: { yearId: string; excludeSubjectId?: string | null }
): NotesFolderSubjectOption[] {
  return subjects.filter(
    (s) =>
      s.year_id === opts.yearId &&
      (!opts.excludeSubjectId || s.id !== opts.excludeSubjectId)
  );
}

export function notesFolderEditRevalidatePaths(): string[] {
  return [
    "/admin/materials",
    "/admin/free-resources",
    "/admin/library",
    "/notes",
    "/free-resources",
    "/free-resources/notes",
    "/library",
    "/academic",
    "/materials",
    "/resources",
  ];
}

export function notesFolderEditErrorMessage(code: string): string {
  switch (code) {
    case "permission_denied":
      return "You need Manage materials permission to edit Notes folders.";
    case "year_scope_denied":
      return "You do not have access to this class year.";
    case "notes_folder_subject_year_mismatch":
      return "Subject must belong to the same class year as the folder.";
    case "notes_folder_subject_required":
    case "subject_not_found":
      return "Choose a valid subject for this Notes folder.";
    case "folder_name_required":
      return "Folder name required.";
    case "folder_deleted":
      return "That folder is in the Bin and cannot be edited.";
    case "notes_folder_only":
      return "Only Notes folders can be edited this way.";
    case "folder_not_found":
      return "Folder not found.";
    case "nothing_to_update":
      return "Nothing to update.";
    case "not_authenticated":
      return "Sign in again to continue.";
    default:
      return code;
  }
}
