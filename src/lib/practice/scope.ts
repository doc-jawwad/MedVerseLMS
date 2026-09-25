import type { PracticeScopeType } from "./types.ts";
import { isPracticeScopeType } from "./types.ts";

/** Map RPC / PostgREST error text to a student-facing practice message. */
export function practiceBatchAccessMessage(
  errorMessage: string | null | undefined
): string {
  const msg = errorMessage ?? "";
  if (msg.includes("practice_access_denied")) {
    return "You don't have practice access for this content. Ask your admin.";
  }
  if (msg.includes("day_not_published")) {
    return "This Prof. Session day is not published yet.";
  }
  if (msg.includes("day_not_found")) {
    return "This Prof. Session day was not found.";
  }
  if (msg.includes("subject_id_required")) {
    return "This day is missing a subject link. Ask your admin.";
  }
  if (msg.includes("not_authenticated")) {
    return "Sign in to practice.";
  }
  if (msg.includes("mcq_bank_folder_not_found")) {
    return "This MCQ Bank folder was not found.";
  }
  if (msg.includes("invalid scope type")) {
    return "Invalid practice scope.";
  }
  return "Could not load practice questions. Please try again.";
}

export function parsePracticeScopeParam(
  scope: string | undefined
): PracticeScopeType | null {
  if (!scope) return null;
  return isPracticeScopeType(scope) ? scope : null;
}
