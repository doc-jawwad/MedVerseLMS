import type { ClassLockKind, ClassLockState } from "@/lib/profile/types";

export type ClassLockDeriveInput = {
  currentYearId: string | null;
  currentYearName: string | null;
  currentYearNumber: number | null;
  hasLiveSubscription: boolean;
  hasPendingApplication: boolean;
  subscriptionYearId?: string | null;
  subscriptionYearName?: string | null;
  pendingApplicationId?: string | null;
  pendingApplicationYearId?: string | null;
  pendingApplicationYearName?: string | null;
};

/**
 * SPEC FREEZE class lock:
 * - free → self-serve class change
 * - pending application → locked (frozen product rule)
 * - active/live subscription → locked to subscription.year_id
 */
export function deriveClassLockState(
  input: ClassLockDeriveInput
): ClassLockState {
  const pendingYearId =
    input.pendingApplicationYearId ?? input.currentYearId ?? null;
  const pendingYearName =
    input.pendingApplicationYearName ??
    (pendingYearId === input.currentYearId ? input.currentYearName : null) ??
    null;

  const subscriptionYearId =
    input.subscriptionYearId ?? input.currentYearId ?? null;
  const subscriptionYearName =
    input.subscriptionYearName ??
    (subscriptionYearId === input.currentYearId
      ? input.currentYearName
      : null) ??
    null;

  let lock: ClassLockKind = "free";
  if (input.hasLiveSubscription) {
    lock = "active_subscription";
  } else if (input.hasPendingApplication) {
    lock = "pending_application";
  }

  const canSelfChange = lock === "free";

  if (lock === "active_subscription") {
    return {
      year_id: subscriptionYearId,
      year_number: input.currentYearNumber,
      year_name: subscriptionYearName ?? input.currentYearName,
      lock,
      can_self_change: canSelfChange,
      subscription_year_id: subscriptionYearId,
      subscription_year_name: subscriptionYearName,
      pending_application_id: input.pendingApplicationId ?? null,
      pending_application_year_id: input.pendingApplicationYearId ?? null,
      pending_application_year_name: input.pendingApplicationYearName ?? null,
    };
  }

  if (lock === "pending_application") {
    return {
      year_id: pendingYearId,
      year_number: input.currentYearNumber,
      year_name: pendingYearName ?? input.currentYearName,
      lock,
      can_self_change: canSelfChange,
      subscription_year_id: null,
      subscription_year_name: null,
      pending_application_id: input.pendingApplicationId ?? null,
      pending_application_year_id: pendingYearId,
      pending_application_year_name: pendingYearName,
    };
  }

  return {
    year_id: input.currentYearId,
    year_number: input.currentYearNumber,
    year_name: input.currentYearName,
    lock,
    can_self_change: true,
    subscription_year_id: null,
    subscription_year_name: null,
    pending_application_id: null,
    pending_application_year_id: null,
    pending_application_year_name: null,
  };
}

export function classLockAllowsSelfChange(lock: ClassLockKind): boolean {
  return lock === "free";
}
