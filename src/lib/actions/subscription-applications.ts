"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isPrivatePaymentScreenshotKey,
  validatePaymentAmount,
  validatePaymentScreenshotFile,
} from "@/lib/payments/application";
import { getR2Config, presignR2Object, putR2Object } from "@/lib/r2/presign";
import { revalidateAdminSubscriptionPaths } from "@/lib/actions/subscription-revalidate";

async function rpcError(error: { message: string } | null) {
  return { error: error?.message };
}

export async function getPaymentInstructions() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_payment_instructions");
  if (error) return { error: error.message };
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
}) {
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
  return rpcError(error);
}

export async function createSubscriptionApplication(input: {
  amount: number;
  screenshotObjectKey: string;
  planId?: string | null;
  currency?: string | null;
}) {
  const amountError = validatePaymentAmount(input.amount);
  if (amountError) return { error: amountError };
  if (!isPrivatePaymentScreenshotKey(input.screenshotObjectKey)) {
    return { error: "invalid_screenshot_object_key" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_subscription_application", {
    p_amount: input.amount,
    p_screenshot_object_key: input.screenshotObjectKey,
    p_plan_id: input.planId ?? null,
    p_currency: input.currency ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function updatePendingSubscriptionApplication(input: {
  applicationId: string;
  amount?: number | null;
  screenshotObjectKey?: string | null;
  planId?: string | null;
  currency?: string | null;
}) {
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
  const { error } = await supabase.rpc("update_pending_subscription_application", {
    p_application_id: input.applicationId,
    p_amount: input.amount ?? null,
    p_screenshot_object_key: input.screenshotObjectKey ?? null,
    p_plan_id: input.planId ?? null,
    p_currency: input.currency ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return rpcError(error);
}

export async function approveSubscriptionApplication(
  applicationId: string,
  reviewNote?: string | null
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_subscription_application", {
    p_application_id: applicationId,
    p_review_note: reviewNote ?? null,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return { error: error.message };
  return { subscriptionId: data as string };
}

export async function rejectSubscriptionApplication(
  applicationId: string,
  reviewNote?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_subscription_application", {
    p_application_id: applicationId,
    p_review_note: reviewNote ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return rpcError(error);
}

export async function uploadPaymentScreenshot(formData: FormData) {
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
  if (allocError) return { error: allocError.message };
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
  if (uploaded.error) return { error: uploaded.error };
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
  if (error) return { error: error.message };
  if (typeof key !== "string") return { error: "screenshot_access_denied" };
  const signed = presignR2Object({ method: "GET", key });
  if ("error" in signed) return signed;
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
  if (error) return { error: error.message };
  if (typeof key !== "string") return { error: "screenshot_access_denied" };
  const signed = presignR2Object({ method: "PUT", key });
  if ("error" in signed) return signed;
  return { url: signed.url, objectKey: key, expiresSeconds: 300 };
}
