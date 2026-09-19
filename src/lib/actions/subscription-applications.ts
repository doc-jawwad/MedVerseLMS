"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isPrivatePaymentScreenshotKey,
  validatePaymentAmount,
  validatePaymentScreenshotFile,
} from "@/lib/payments/application";
import {
  deleteR2Object,
  getR2Config,
  presignR2Object,
  putR2Object,
} from "@/lib/r2/presign";
import { revalidateAdminSubscriptionPaths } from "@/lib/actions/subscription-revalidate";
import { clientActionFailed, toClientActionError } from "@/lib/errors/safe-action-error";

async function currentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}

/** Best-effort R2 delete for a key owned by the caller (prefix check). */
export async function discardPaymentScreenshot(
  objectKey: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid) return clientActionFailed("discardPaymentScreenshot", "not_authenticated");
  if (!isPrivatePaymentScreenshotKey(objectKey, uid)) {
    return clientActionFailed(
      "discardPaymentScreenshot",
      "invalid_screenshot_object_key"
    );
  }
  const config = getR2Config();
  if ("error" in config) {
    return clientActionFailed("discardPaymentScreenshot", config.error);
  }
  const deleted = await deleteR2Object({ key: objectKey, config });
  if (deleted.error) {
    // Log but do not fail the UX hard — orphan GC is best-effort.
    toClientActionError(deleted.error, "discardPaymentScreenshot.r2");
  }
  return {};
}

async function deleteOwnedProofBestEffort(objectKey: string | null | undefined) {
  if (!objectKey || !isPrivatePaymentScreenshotKey(objectKey)) return;
  const config = getR2Config();
  if ("error" in config) {
    toClientActionError(config.error, "deleteOwnedProof.config");
    return;
  }
  const deleted = await deleteR2Object({ key: objectKey, config });
  if (deleted.error) {
    toClientActionError(deleted.error, "deleteOwnedProof.r2");
  }
}

export async function getPaymentInstructions() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_payment_instructions");
  if (error) {
    return clientActionFailed("getPaymentInstructions", error);
  }
  return { instructions: data };
}

export async function upsertPaymentSettings(input: {
  bankName?: string | null;
  accountTitle?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  paymentInstructions?: string | null;
  qrReference?: string | null;
  currency?: string | null;
  isActive?: boolean | null;
  subscriptionGraceDays?: number | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_payment_settings", {
    p_bank_name: input.bankName ?? null,
    p_account_title: input.accountTitle ?? null,
    p_account_number: input.accountNumber ?? null,
    p_iban: input.iban ?? null,
    p_payment_instructions: input.paymentInstructions ?? null,
    p_qr_reference: input.qrReference ?? null,
    p_currency: input.currency ?? null,
    p_is_active: input.isActive ?? null,
    p_subscription_grace_days: input.subscriptionGraceDays ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return clientActionFailed("upsertPaymentSettings", error);
  return {};
}

export async function createSubscriptionApplication(input: {
  amount: number;
  screenshotObjectKey: string;
  planId?: string | null;
  currency?: string | null;
}): Promise<{ error: string } | { id: string }> {
  const amountError = validatePaymentAmount(input.amount);
  if (amountError) return { error: amountError };
  if (!isPrivatePaymentScreenshotKey(input.screenshotObjectKey)) {
    return { error: "invalid_screenshot_object_key" };
  }
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid || !isPrivatePaymentScreenshotKey(input.screenshotObjectKey, uid)) {
    return { error: "invalid_screenshot_object_key" };
  }
  const { data, error } = await supabase.rpc("create_subscription_application", {
    p_amount: input.amount,
    p_screenshot_object_key: input.screenshotObjectKey,
    p_plan_id: input.planId ?? null,
    p_currency: input.currency ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) {
    await deleteOwnedProofBestEffort(input.screenshotObjectKey);
    return clientActionFailed("createSubscriptionApplication", error);
  }
  return { id: data as string };
}

export async function updatePendingSubscriptionApplication(input: {
  applicationId: string;
  amount?: number | null;
  screenshotObjectKey?: string | null;
  planId?: string | null;
  currency?: string | null;
}): Promise<{ error?: string }> {
  if (input.amount != null) {
    const amountError = validatePaymentAmount(input.amount);
    if (amountError) return { error: amountError };
  }
  if (
    input.screenshotObjectKey &&
    !isPrivatePaymentScreenshotKey(input.screenshotObjectKey)
  ) {
    return { error: "invalid_screenshot_object_key" };
  }
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (
    input.screenshotObjectKey &&
    (!uid || !isPrivatePaymentScreenshotKey(input.screenshotObjectKey, uid))
  ) {
    return { error: "invalid_screenshot_object_key" };
  }

  let previousKey: string | null = null;
  if (input.screenshotObjectKey) {
    const { data: row } = await supabase
      .from("subscription_applications")
      .select("screenshot_object_key")
      .eq("id", input.applicationId)
      .maybeSingle();
    previousKey = row?.screenshot_object_key ?? null;
  }

  const { error } = await supabase.rpc("update_pending_subscription_application", {
    p_application_id: input.applicationId,
    p_amount: input.amount ?? null,
    p_screenshot_object_key: input.screenshotObjectKey ?? null,
    p_plan_id: input.planId ?? null,
    p_currency: input.currency ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) {
    if (input.screenshotObjectKey) {
      await deleteOwnedProofBestEffort(input.screenshotObjectKey);
    }
    return clientActionFailed("updatePendingSubscriptionApplication", error);
  }
  if (
    input.screenshotObjectKey &&
    previousKey &&
    previousKey !== input.screenshotObjectKey
  ) {
    await deleteOwnedProofBestEffort(previousKey);
  }
  return {};
}

export async function approveSubscriptionApplication(
  applicationId: string,
  reviewNote?: string | null
): Promise<{ error?: string; subscriptionId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_subscription_application", {
    p_application_id: applicationId,
    p_review_note: reviewNote ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return clientActionFailed("approveSubscriptionApplication", error);
  return { subscriptionId: data as string };
}

export async function rejectSubscriptionApplication(
  applicationId: string,
  reviewNote?: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("subscription_applications")
    .select("screenshot_object_key")
    .eq("id", applicationId)
    .maybeSingle();
  const proofKey = row?.screenshot_object_key ?? null;

  const { error } = await supabase.rpc("reject_subscription_application", {
    p_application_id: applicationId,
    p_review_note: reviewNote ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return clientActionFailed("rejectSubscriptionApplication", error);
  // After reject, remove private bytes from R2 (row may still store the key).
  await deleteOwnedProofBestEffort(proofKey);
  return {};
}

export async function uploadPaymentScreenshot(
  formData: FormData
): Promise<{ error: string } | { objectKey: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "invalid_screenshot_type" };
  const fileError = validatePaymentScreenshotFile({
    type: file.type,
    size: file.size,
  });
  if (fileError) return { error: fileError };

  const supabase = await createClient();
  const { data: key, error: allocError } = await supabase.rpc(
    "allocate_payment_screenshot_object_key"
  );
  if (allocError) {
    return clientActionFailed("uploadPaymentScreenshot.allocate", allocError);
  }
  if (typeof key !== "string" || !isPrivatePaymentScreenshotKey(key)) {
    return { error: "invalid_screenshot_object_key" };
  }

  const config = getR2Config();
  if ("error" in config) return { error: config.error };
  const body = Buffer.from(await file.arrayBuffer());
  const uploaded = await putR2Object({
    key,
    body,
    contentType: file.type,
  });
  if (uploaded.error) {
    return clientActionFailed(
      "uploadPaymentScreenshot.put",
      uploaded.error,
      "Could not upload the screenshot. Please try again."
    );
  }
  return { objectKey: key };
}

export async function getPaymentScreenshotReadUrl(applicationId: string) {
  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc(
    "authorize_payment_screenshot_access",
    {
      p_application_id: applicationId,
      p_purpose: "read",
    }
  );
  if (error) return clientActionFailed("getPaymentScreenshotReadUrl", error);
  if (typeof key !== "string") return { error: "screenshot_access_denied" };
  const signed = presignR2Object({ method: "GET", key });
  if ("error" in signed) {
    return clientActionFailed("getPaymentScreenshotReadUrl.sign", signed.error);
  }
  return { url: signed.url, expiresSeconds: 300 };
}

export async function getPaymentScreenshotWriteUrl(applicationId: string) {
  const supabase = await createClient();
  const { data: key, error } = await supabase.rpc(
    "authorize_payment_screenshot_access",
    {
      p_application_id: applicationId,
      p_purpose: "write",
    }
  );
  if (error) return clientActionFailed("getPaymentScreenshotWriteUrl", error);
  if (typeof key !== "string") return { error: "screenshot_access_denied" };
  const signed = presignR2Object({ method: "PUT", key });
  if ("error" in signed) {
    return clientActionFailed("getPaymentScreenshotWriteUrl.sign", signed.error);
  }
  return { url: signed.url, objectKey: key, expiresSeconds: 300 };
}
