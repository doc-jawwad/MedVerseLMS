export const PAYMENT_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export const PAYMENT_SCREENSHOT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PaymentScreenshotContentType =
  (typeof PAYMENT_SCREENSHOT_CONTENT_TYPES)[number];

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

export function validatePaymentScreenshotFile(file: {
  type?: string | null;
  size?: number | null;
}): string | null {
  const type = file.type ?? "";
  const size = file.size ?? 0;
  if (
    !PAYMENT_SCREENSHOT_CONTENT_TYPES.includes(
      type as PaymentScreenshotContentType
    )
  ) {
    return "invalid_screenshot_type";
  }
  if (size <= 0 || size > PAYMENT_SCREENSHOT_MAX_BYTES) {
    return "invalid_screenshot_size";
  }
  return null;
}
