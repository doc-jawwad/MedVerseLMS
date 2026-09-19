export const STUDY_PDF_MAX_BYTES = 25 * 1024 * 1024;
export const STUDY_COVER_MAX_BYTES = 2 * 1024 * 1024;

export const STUDY_PDF_CONTENT_TYPE = "application/pdf";

export const STUDY_COVER_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function isStudyPdfFile(file: { type: string; size: number }): string | null {
  if (file.type !== STUDY_PDF_CONTENT_TYPE) return "pdf_type_invalid";
  if (file.size <= 0 || file.size > STUDY_PDF_MAX_BYTES) return "pdf_too_large";
  return null;
}

export function isStudyCoverFile(file: { type: string; size: number }): string | null {
  if (
    !STUDY_COVER_CONTENT_TYPES.includes(
      file.type as (typeof STUDY_COVER_CONTENT_TYPES)[number]
    )
  ) {
    return "cover_type_invalid";
  }
  if (file.size <= 0 || file.size > STUDY_COVER_MAX_BYTES) return "cover_too_large";
  return null;
}
