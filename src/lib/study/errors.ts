const MESSAGES: Record<string, string> = {
  pearl_access_denied: "You do not have access to this One Liner.",
  pearl_object_denied: "You do not have access to this One Liner PDF.",
  ospe_access_denied: "You do not have access to this OSPE station.",
  ospe_object_denied: "You do not have access to this station image.",
  material_access_denied: "You do not have access to this resource.",
  material_wrong_kind: "This item cannot be opened that way.",
  study_object_denied: "You do not have access to this PDF.",
  test_prep_denied: "Preparation guidelines are not available for this test.",
  pdf_type_invalid: "Upload a PDF file.",
  pdf_empty: "Choose a PDF file.",
  pdf_magic_invalid: "That file is not a valid PDF.",
  pdf_size_mismatch: "Uploaded file size did not match. Try again.",
  cover_type_invalid: "Cover images must be JPEG, PNG, or WebP.",
  cover_too_large: "That cover image is larger than 2 MB.",
  ospe_image_type_invalid: "Station images must be JPEG, PNG, or WebP.",
  ospe_image_too_large: "That station image is larger than 10 MB.",
  permission_denied: "You do not have permission to do that.",
  not_authenticated: "Sign in to continue.",
  folder_not_found: "That folder was not found.",
  upload_session_invalid: "Upload session is invalid. Start again.",
  upload_session_expired: "Upload session expired. Start again.",
  upload_session_secret_missing: "Upload is temporarily unavailable.",
  upload_parts_required: "No upload parts to sign.",
  upload_parts_batch_too_large: "Too many parts requested at once.",
  upload_parts_incomplete: "Upload is incomplete. Wait for all parts, then retry.",
  upload_part_failed: "A part failed to upload. Retrying…",
  upload_cancelled: "Upload cancelled.",
};

export function studyErrorMessage(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(key)) return message;
  }
  return trimmed || "Something went wrong. Please try again.";
}
