import type { ClassLockKind, ClassLockState } from "@/lib/profile/types";

/** Extremely clear lock copy, e.g. "Your subscription is for 2nd Year MBBS". */
export function classLockHeadline(state: ClassLockState): string {
  const name = state.year_name?.trim() || "your class";
  if (state.lock === "active_subscription") {
    return `Your subscription is for ${name}`;
  }
  if (state.lock === "pending_application") {
    return `Your pending subscription is for ${name}`;
  }
  return `Your current class is ${name}`;
}

export function classLockExplanation(lock: ClassLockKind): string {
  switch (lock) {
    case "free":
      return "You can change your class anytime while you do not have a live or pending subscription.";
    case "pending_application":
      return "Class stays locked while your subscription application is under review. An admin can approve a class change if you need a different year.";
    case "active_subscription":
      return "Class stays locked to your purchased subscription year. Ask an admin if you need an approved class change.";
  }
}

export function classLockBadgeLabel(lock: ClassLockKind): string {
  switch (lock) {
    case "free":
      return "Class unlocked";
    case "pending_application":
      return "Class locked — pending subscription";
    case "active_subscription":
      return "Class locked — active subscription";
  }
}

/** Locked controls should look intentional, not broken. */
export function classControlDisabledReason(state: ClassLockState): string | null {
  if (state.can_self_change) return null;
  return classLockHeadline(state);
}

export function purchaseClassConfirmLabel(yearName: string): string {
  const name = yearName.trim() || "the selected class";
  return `I confirm this subscription purchase is for ${name}`;
}

export function purchaseClassPrompt(yearName: string): string {
  const name = yearName.trim() || "your class";
  return `You are purchasing access for ${name}. Confirm before submitting payment proof.`;
}

export function profileErrorMessage(code: string): string {
  const c = code.trim().toLowerCase();
  if (c.includes("class_locked")) {
    return "Your class is locked by your subscription. Request an admin-approved change instead.";
  }
  if (c.includes("invalid_year")) {
    return "That class is not available.";
  }
  if (
    c.includes("spine_unavailable") ||
    (c.includes("function") && c.includes("does not exist"))
  ) {
    return "This action is not available yet. Please try again after the next system update.";
  }
  if (c.includes("avatar")) {
    return "Profile photo could not be updated. Please try again.";
  }
  if (c.includes("permission")) {
    return "You do not have permission to do that.";
  }
  if (/^[a-z][a-z0-9_]*$/.test(code.trim())) {
    return code.replace(/_/g, " ");
  }
  return "Something went wrong. Please try again.";
}
