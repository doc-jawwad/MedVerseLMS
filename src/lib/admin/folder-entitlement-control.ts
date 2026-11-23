/**
 * MCQ Bank access is decided per subject (practice_subject), not per folder.
 * The MCQ Bank shadow folder's own entitlement is not a student boundary, so
 * the admin UI must not offer a per-folder Free/Paid control for it.
 * See docs/permissions.md §Practice.
 */
export function folderEntitlementIsSubjectLevel(libraryType: string): boolean {
  return libraryType === "mcq_bank";
}

/** Where the subject-level (practice_subject) Free/Paid switch lives. */
export const SUBJECT_ACCESS_ADMIN_HREF = "/admin/free-resources?type=mcq-bank";
