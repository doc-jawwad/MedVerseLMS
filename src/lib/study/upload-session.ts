import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type StudyPdfUploadMode = "put" | "multipart";

export type StudyPdfUploadSessionPayload = {
  v: 1;
  key: string;
  uploadId: string | null;
  folderId: string;
  mode: StudyPdfUploadMode;
  declaredSize: number;
  contentType: "application/pdf";
  uid: string;
  partSize: number;
  partCount: number;
  exp: number;
};

function sessionSecret(): string {
  // Prefer dedicated secret; fall back to R2 secret so staging works without new env.
  const dedicated = process.env.STUDY_UPLOAD_SESSION_SECRET?.trim();
  if (dedicated) return dedicated;
  const r2 = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (r2) return `study-upload-v1:${r2}`;
  return "";
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function sealStudyPdfUploadSession(
  payload: StudyPdfUploadSessionPayload
): { token: string } | { error: string } {
  const secret = sessionSecret();
  if (!secret) return { error: "upload_session_secret_missing" };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return { token: `${body}.${sig}` };
}

export function openStudyPdfUploadSession(
  token: string
): StudyPdfUploadSessionPayload | { error: string } {
  const secret = sessionSecret();
  if (!secret) return { error: "upload_session_secret_missing" };
  const [body, sig] = token.split(".");
  if (!body || !sig) return { error: "upload_session_invalid" };
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = fromB64url(sig);
  } catch {
    return { error: "upload_session_invalid" };
  }
  if (
    expected.length !== given.length ||
    !timingSafeEqual(expected, given)
  ) {
    return { error: "upload_session_invalid" };
  }
  let payload: StudyPdfUploadSessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { error: "upload_session_invalid" };
  }
  if (payload?.v !== 1 || typeof payload.key !== "string") {
    return { error: "upload_session_invalid" };
  }
  if (payload.exp * 1000 < Date.now()) {
    return { error: "upload_session_expired" };
  }
  return payload;
}

/** Single PUT below this; multipart at/above. */
export const STUDY_PDF_MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024;
export const STUDY_PDF_MIN_PART_BYTES = 8 * 1024 * 1024;
export const STUDY_PDF_TARGET_PART_BYTES = 16 * 1024 * 1024;
export const STUDY_PDF_MAX_PARTS = 9000;
/** Part URL / session lifetime. */
export const STUDY_PDF_UPLOAD_SESSION_TTL_SECONDS = 60 * 60;

export function chooseStudyPdfParting(byteSize: number): {
  mode: StudyPdfUploadMode;
  partSize: number;
  partCount: number;
} {
  if (byteSize < STUDY_PDF_MULTIPART_THRESHOLD_BYTES) {
    return { mode: "put", partSize: byteSize, partCount: 1 };
  }
  let partSize = STUDY_PDF_TARGET_PART_BYTES;
  if (Math.ceil(byteSize / partSize) > STUDY_PDF_MAX_PARTS) {
    partSize = Math.ceil(byteSize / STUDY_PDF_MAX_PARTS);
    // Round up to 1 MiB
    partSize = Math.ceil(partSize / (1024 * 1024)) * 1024 * 1024;
  }
  partSize = Math.max(partSize, STUDY_PDF_MIN_PART_BYTES);
  const partCount = Math.ceil(byteSize / partSize);
  return { mode: "multipart", partSize, partCount };
}
