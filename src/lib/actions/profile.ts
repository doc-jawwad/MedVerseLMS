"use server";

import { revalidatePath } from "next/cache";
import {
  createStudentProfileAdapter,
  createSubscriptionClassAdapter,
} from "@/lib/profile/adapter";
import { profileErrorMessage } from "@/lib/profile/presentation";
import {
  validateAvatarFile,
  validateCollegeName,
  validateContactNumber,
  validateFullName,
  validatePurchaseClassConfirmation,
} from "@/lib/profile/validation";
import { putR2Object } from "@/lib/r2/presign";

export type ProfileActionResult =
  | { ok: true }
  | { ok: false; error: string };

function fail(error: string): ProfileActionResult {
  return { ok: false, error: profileErrorMessage(error) };
}

export async function updateOwnProfileAction(input: {
  fullName: string;
  contactNumber: string;
  collegeName: string;
}): Promise<ProfileActionResult> {
  const nameErr = validateFullName(input.fullName);
  if (nameErr) return { ok: false, error: nameErr };
  const phoneErr = validateContactNumber(input.contactNumber || null);
  if (phoneErr) return { ok: false, error: phoneErr };
  const collegeErr = validateCollegeName(input.collegeName || null);
  if (collegeErr) return { ok: false, error: collegeErr };

  const adapter = createStudentProfileAdapter();
  const result = await adapter.updateOwnProfile({
    full_name: input.fullName.trim(),
    contact_number: input.contactNumber.trim() || null,
    college_name: input.collegeName.trim() || null,
  });
  if (!result.ok) return fail(result.error);
  revalidatePath("/profile");
  return { ok: true };
}

export async function selfChangeClassAction(
  yearId: string
): Promise<ProfileActionResult> {
  if (!yearId) return { ok: false, error: "Select a class." };
  const adapter = createSubscriptionClassAdapter();
  const result = await adapter.selfChangeClass(yearId);
  if (!result.ok) return fail(result.error);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function recordPurchaseClassIntentAction(input: {
  yearId: string;
  yearName: string;
  confirmed: boolean;
}): Promise<ProfileActionResult> {
  const err = validatePurchaseClassConfirmation({
    yearId: input.yearId,
    confirmed: input.confirmed,
  });
  if (err) return { ok: false, error: err };
  const adapter = createSubscriptionClassAdapter();
  const result = await adapter.recordPurchaseClassIntent({
    year_id: input.yearId,
    year_name: input.yearName,
    confirmed: input.confirmed,
  });
  if (!result.ok) return fail(result.error);
  return { ok: true };
}

export async function uploadAvatarAction(
  formData: FormData
): Promise<ProfileActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a profile photo." };
  }
  const fileErr = validateAvatarFile({ type: file.type, size: file.size });
  if (fileErr) return { ok: false, error: fileErr };

  const adapter = createStudentProfileAdapter();
  const allocated = await adapter.allocateAvatarUpload();
  if (!allocated.ok) return fail(allocated.error);

  const uploaded = await putR2Object({
    key: allocated.data.objectKey,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || "image/jpeg",
  });
  if (uploaded.error) {
    return fail(uploaded.error);
  }

  const saved = await adapter.setAvatarObjectKey(allocated.data.objectKey);
  if (!saved.ok) return fail(saved.error);
  revalidatePath("/profile");
  return { ok: true };
}

export async function clearAvatarAction(): Promise<ProfileActionResult> {
  const adapter = createStudentProfileAdapter();
  const result = await adapter.clearAvatar();
  if (!result.ok) return fail(result.error);
  revalidatePath("/profile");
  return { ok: true };
}
