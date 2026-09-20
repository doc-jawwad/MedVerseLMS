export function normalizeContactNumber(raw: string): string {
  return raw.replace(/[\s()-]/g, "").trim();
}

export function validateContactNumber(
  raw: string | null | undefined
): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const cleaned = normalizeContactNumber(String(raw));
  if (cleaned.length < 7 || cleaned.length > 20) {
    return "Enter a valid contact number (7–20 digits).";
  }
  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return "Contact number may only include digits and an optional leading +.";
  }
  return null;
}

export function validateCollegeName(
  raw: string | null | undefined
): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const name = String(raw).trim();
  if (name.length < 2) return "College name is too short.";
  if (name.length > 120) return "College name is too long.";
  return null;
}

export function validateFullName(raw: string | null | undefined): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return "Full name is required.";
  if (name.length < 2) return "Full name is too short.";
  if (name.length > 120) return "Full name is too long.";
  return null;
}

export function validatePurchaseClassConfirmation(input: {
  yearId: string;
  confirmed: boolean;
}): string | null {
  if (!input.yearId) return "Select the class this subscription is for.";
  if (!input.confirmed) {
    return "Confirm the purchase class before submitting.";
  }
  return null;
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateAvatarFile(file: {
  type: string;
  size: number;
}): string | null {
  if (!AVATAR_TYPES.has(file.type)) {
    return "Use a JPEG, PNG, or WebP image.";
  }
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    return "Profile photo must be under 2 MB.";
  }
  return null;
}

export { AVATAR_MAX_BYTES };
