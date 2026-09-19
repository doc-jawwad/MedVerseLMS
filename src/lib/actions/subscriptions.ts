"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";

import { createClient } from "@/lib/supabase/server";
import { revalidateAdminSubscriptionPaths } from "@/lib/actions/subscription-revalidate";

export async function activateSubscription(
  studentId: string,
  planId: string,
  startsAt?: string | null,
  endsAt?: string | null,
  graceDays?: number | null,
  paidAccessMode?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_subscription", {
    p_student_id: studentId,
    p_plan_id: planId,
    p_starts_at: startsAt ?? null,
    p_ends_at: endsAt ?? null,
    p_grace_days: graceDays ?? null,
    p_paid_access_mode: paidAccessMode ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function extendSubscription(
  subscriptionId: string,
  days?: number | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_subscription", {
    p_subscription_id: subscriptionId,
    p_days: days ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function setSubscriptionAccess(
  subscriptionId: string,
  graceDays?: number | null,
  paidAccessMode?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_subscription_access", {
    p_subscription_id: subscriptionId,
    p_grace_days: graceDays ?? null,
    p_paid_access_mode: paidAccessMode ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function setSubscriptionEnd(
  subscriptionId: string,
  endsAt: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_subscription_end", {
    p_subscription_id: subscriptionId,
    p_ends_at: endsAt,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function deactivateSubscription(subscriptionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_subscription", {
    p_subscription_id: subscriptionId,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function restoreSubscription(subscriptionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_subscription", {
    p_subscription_id: subscriptionId,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function assignSubscriptionPlan(
  subscriptionId: string,
  planId: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_subscription_plan", {
    p_subscription_id: subscriptionId,
    p_plan_id: planId,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}

export async function createSubscriptionPlan(input: {
  name: string;
  description?: string | null;
  durationDays?: number | null;
  isComplimentary?: boolean | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_subscription_plan", {
    p_name: input.name,
    p_description: input.description ?? "",
    p_duration_days: input.durationDays ?? 365,
    p_is_complimentary: input.isComplimentary ?? false,
    p_is_active: input.isActive ?? true,
    p_sort_order: input.sortOrder ?? 0,
  });
  revalidateAdminSubscriptionPaths();
  if (error) return actionRpcResult("action", error);
  return { id: data as string };
}

export async function updateSubscriptionPlan(input: {
  planId: string;
  name?: string | null;
  description?: string | null;
  durationDays?: number | null;
  isComplimentary?: boolean | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_subscription_plan", {
    p_plan_id: input.planId,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_duration_days: input.durationDays ?? null,
    p_is_complimentary: input.isComplimentary ?? null,
    p_is_active: input.isActive ?? null,
    p_sort_order: input.sortOrder ?? null,
  });
  revalidateAdminSubscriptionPaths();
  return actionRpcResult("action", error);
}
