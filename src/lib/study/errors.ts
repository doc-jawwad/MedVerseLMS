const MESSAGES: Record<string, string> = {
  pearl_access_denied: "You do not have access to this pearl point.",
  ospe_access_denied: "You do not have access to this OSPE station.",
  ospe_object_denied: "You do not have access to this station image.",
  material_access_denied: "You do not have access to this resource.",
  material_wrong_kind: "This item cannot be opened that way.",
  study_object_denied: "You do not have access to this PDF.",
  test_prep_denied: "Preparation guidelines are not available for this test.",
  pdf_type_invalid: "Upload a PDF file.",
  pdf_too_large: "That PDF is larger than 25 MB.",
  cover_type_invalid: "Cover images must be JPEG, PNG, or WebP.",
  cover_too_large: "That cover image is larger than 2 MB.",
  ospe_image_type_invalid: "Station images must be JPEG, PNG, or WebP.",
  ospe_image_too_large: "That station image is larger than 10 MB.",
  permission_denied: "You do not have permission to do that.",
};

export function studyErrorMessage(code: string | null | undefined): string {
  const trimmed = (code ?? "").trim();
  if (MESSAGES[trimmed]) return MESSAGES[trimmed];
  for (const [key, message] of Object.entries(MESSAGES)) {
    if (trimmed.includes(key)) return message;
  }
  return trimmed || "Something went wrong. Please try again.";
}
