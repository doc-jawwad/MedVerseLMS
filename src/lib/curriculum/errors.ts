/** Client-safe curriculum admin error messages (snake_case RPC codes). */

const MESSAGES: Record<string, string> = {
  permission_denied: "You do not have permission to manage curriculum.",
  not_authenticated: "Sign in to continue.",
  year_scope_denied: "You do not have access to that class.",
  curriculum_not_found: "That curriculum item was not found.",
  invalid_curriculum_kind: "Unsupported curriculum item type.",
  curriculum_has_children:
    "Remove all child items under this node before deleting it.",
  curriculum_has_questions:
    "This node still has questions (including items in the Content Bin). Move or purge those questions first.",
  curriculum_has_tests:
    "This subject is still linked to one or more tests. Reassign or remove those tests first.",
  curriculum_has_materials:
    "This subject still has study materials or folders (including Bin items). Remove or purge them first.",
  curriculum_has_mcq_folders:
    "This subject still has MCQ Bank folders. Remove or purge them first.",
  curriculum_has_ospe:
    "This subject still has OSPE stations (including Bin items). Remove or purge them first.",
  curriculum_has_prof_session:
    "This subject still has Prof. Session days. Remove or purge them first.",
  curriculum_has_pearls:
    "This subject still has Pearl Points (including Bin items). Remove or purge them first.",
  curriculum_has_one_liners:
    "This subject still has One-Liners (including Bin items). Remove or purge them first.",
  product_subject_protected:
    "Block / Final Year product subjects cannot be deleted from Curriculum.",
};

export function curriculumErrorMessage(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim().toLowerCase();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(key)) return message;
  }
  return trimmed || "Something went wrong. Please try again.";
}
