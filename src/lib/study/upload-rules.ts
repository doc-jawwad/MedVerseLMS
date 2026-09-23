export const STUDY_COVER_MAX_BYTES = 2 * 1024 * 1024;
/** OSPE station photos — larger than cover thumbs, still private study-content. */
export const OSPE_STATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const STUDY_PDF_CONTENT_TYPE = "application/pdf";

export const STUDY_COVER_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const OSPE_STATION_IMAGE_CONTENT_TYPES = STUDY_COVER_CONTENT_TYPES;

/**
 * Client/server PDF meta check — no artificial byte cap.
 * Ceiling is R2 platform limits (multipart), not MedVerse policy.
 */
export function isStudyPdfMeta(file: {
  type: string;
  size: number;
  name?: string;
}): string | null {
  const name = (file.name ?? "").toLowerCase();
  const typeOk =
    file.type === STUDY_PDF_CONTENT_TYPE ||
    (file.type === "" && name.endsWith(".pdf")) ||
    (file.type === "application/octet-stream" && name.endsWith(".pdf"));
  if (!typeOk) return "pdf_type_invalid";
  if (!Number.isFinite(file.size) || file.size <= 0) return "pdf_empty";
  return null;
}

/** @deprecated Prefer isStudyPdfMeta — kept for callers that only have type/size. */
export function isStudyPdfFile(file: { type: string; size: number }): string | null {
  return isStudyPdfMeta(file);
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

export function isOspeStationImageFile(file: {
  type: string;
  size: number;
}): string | null {
  if (
    !OSPE_STATION_IMAGE_CONTENT_TYPES.includes(
      file.type as (typeof OSPE_STATION_IMAGE_CONTENT_TYPES)[number]
    )
  ) {
    return "ospe_image_type_invalid";
  }
  if (file.size <= 0 || file.size > OSPE_STATION_IMAGE_MAX_BYTES) {
    return "ospe_image_too_large";
  }
  return null;
}
