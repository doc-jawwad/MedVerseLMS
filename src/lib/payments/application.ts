/** Original upload ceiling — server still re-encodes to optimized WebP. */
export const PAYMENT_SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;

export const PAYMENT_SCREENSHOT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PaymentScreenshotContentType =
  (typeof PAYMENT_SCREENSHOT_CONTENT_TYPES)[number];

const EXT_TO_CONTENT_TYPE: Record<string, PaymentScreenshotContentType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const HEIC_CONTENT_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type ApplicationStatus = "pending" | "approved" | "rejected" | "cancelled";

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "cancelled"
  );
}

export function canStudentEditApplication(status: string): boolean {
  return status === "pending";
}

export function isTerminalApplicationStatus(status: string): boolean {
  return status === "approved" || status === "rejected" || status === "cancelled";
}

export function validatePaymentAmount(amount: unknown): string | null {
  if (typeof amount === "string" && amount.trim() !== "") {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return "invalid_amount";
    return null;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "invalid_amount";
  }
  return null;
}

export function screenshotObjectKeyLooksPublic(key: string): boolean {
  return /:\/\//.test(key) || /^https?:/i.test(key);
}

export function isPrivatePaymentScreenshotKey(
  key: string,
  studentId?: string
): boolean {
  if (!key || key.length < 20 || key.length > 512) return false;
  if (screenshotObjectKeyLooksPublic(key)) return false;
  if (!key.startsWith("payment-proofs/")) return false;
  if (studentId && !key.includes(`/${studentId}/`)) return false;
  return true;
}

/**
 * Resolve a usable content type for payment screenshots.
 * Mobile browsers often send empty MIME, `image/jpg`, or `application/octet-stream`.
 * Returns `"heic"` when the picker clearly selected an HEIC/HEIF photo (not convertible
 * in our sharp build without libheif — surface a dedicated student error instead).
 */
export function resolvePaymentScreenshotContentType(
  type?: string | null,
  name?: string | null
): PaymentScreenshotContentType | "heic" | null {
  const raw = (type ?? "").trim().toLowerCase();
  const fileName = (name ?? "").trim().toLowerCase();

  if (
    HEIC_CONTENT_TYPES.has(raw) ||
    fileName.endsWith(".heic") ||
    fileName.endsWith(".heif")
  ) {
    return "heic";
  }

  if (raw === "image/jpg" || raw === "image/pjpeg") {
    return "image/jpeg";
  }

  if (
    PAYMENT_SCREENSHOT_CONTENT_TYPES.includes(
      raw as PaymentScreenshotContentType
    )
  ) {
    return raw as PaymentScreenshotContentType;
  }

  // Android / Samsung / Files app: missing or generic MIME — trust extension.
  if (raw === "" || raw === "application/octet-stream") {
    for (const [ext, contentType] of Object.entries(EXT_TO_CONTENT_TYPE)) {
      if (fileName.endsWith(ext)) return contentType;
    }
  }

  return null;
}

export function validatePaymentScreenshotFile(file: {
  type?: string | null;
  size?: number | null;
  name?: string | null;
}): string | null {
  const resolved = resolvePaymentScreenshotContentType(file.type, file.name);
  if (resolved === "heic") return "heic_not_supported";
  if (!resolved) return "invalid_screenshot_type";
  const size = file.size ?? 0;
  if (size <= 0 || size > PAYMENT_SCREENSHOT_MAX_BYTES) {
    return "invalid_screenshot_size";
  }
  return null;
}
