export type SubscriptionRowStatus = "active" | "expired" | "deactivated";

export type ApplicationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type StudentSubscriptionViewKind =
  | "none"
  | "pending"
  | "active"
  | "expired"
  | "deactivated";

export type PaidAccessMode = "all_entitled" | "grants_only";

export type StudentSubscriptionRow = {
  id: string;
  status: SubscriptionRowStatus;
  starts_at: string;
  ends_at: string;
  plan_name: string | null;
  grace_days?: number;
  paid_access_mode?: PaidAccessMode | string | null;
};

export type StudentApplicationRow = {
  id: string;
  status: ApplicationStatus | string;
  amount: number;
  currency: string;
  created_at: string;
  review_note: string | null;
  reviewed_at: string | null;
};

export type StudentSubscriptionView = {
  kind: StudentSubscriptionViewKind;
  label: string;
  description: string;
  /** Live access according to has_live_subscription() — source of truth for unlocks. */
  hasLiveAccess: boolean;
  active: StudentSubscriptionRow | null;
  pending: StudentApplicationRow | null;
  latestNonPendingApplication: StudentApplicationRow | null;
  remainingDays: number | null;
};

function asSubscriptionStatus(value: string): SubscriptionRowStatus | null {
  if (value === "active" || value === "expired" || value === "deactivated") {
    return value;
  }
  return null;
}

export function subscriptionGraceUntil(
  endsAt: string | Date,
  graceDays: number
): Date {
  const days = Number.isFinite(graceDays) ? Math.max(0, Math.trunc(graceDays)) : 0;
  return new Date(new Date(endsAt).getTime() + days * 24 * 60 * 60 * 1000);
}

export function subscriptionIsLiveAt(
  status: string,
  endsAt: string | Date,
  graceDays: number,
  now: Date = new Date()
): boolean {
  return status === "active" && now.getTime() < subscriptionGraceUntil(endsAt, graceDays).getTime();
}

export type ExpiryWarningKind =
  | "subscription_expiry_7d"
  | "subscription_expiry_3d"
  | "subscription_expiry_1d";

/** Pre-expiry warning kind from ends_at (not grace_until). */
export function subscriptionExpiryWarningKind(
  endsAt: string | Date,
  now: Date = new Date()
): ExpiryWarningKind | null {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return null;
  const day = 24 * 60 * 60 * 1000;
  if (ms <= day) return "subscription_expiry_1d";
  if (ms <= 3 * day) return "subscription_expiry_3d";
  if (ms <= 7 * day) return "subscription_expiry_7d";
  return null;
}

/** Whole days remaining until the given instant (floor). */
export function remainingSubscriptionDays(
  endsAt: string | Date,
  now: Date = new Date()
): number {
  const end = new Date(endsAt).getTime();
  const ms = end - now.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Derive the student-facing subscription card state.
 * `hasLiveAccess` must come from `has_live_subscription()` (time-of-read).
 */
export function buildStudentSubscriptionView(input: {
  hasLiveAccess: boolean;
  subscriptions: StudentSubscriptionRow[];
  applications: StudentApplicationRow[];
  now?: Date;
}): StudentSubscriptionView {
  const now = input.now ?? new Date();
  const pending =
    input.applications.find((a) => a.status === "pending") ?? null;
  const latestNonPending =
    input.applications.find((a) => a.status !== "pending") ?? null;

  const sortedSubs = [...input.subscriptions].sort(
    (a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime()
  );

  const activeRow =
    sortedSubs.find((s) =>
      subscriptionIsLiveAt(s.status, s.ends_at, s.grace_days ?? 0, now)
    ) ?? null;

  if (input.hasLiveAccess && activeRow) {
    const graceUntil = subscriptionGraceUntil(
      activeRow.ends_at,
      activeRow.grace_days ?? 0
    );
    const pastEnds = new Date(activeRow.ends_at).getTime() <= now.getTime();
    const days = remainingSubscriptionDays(
      pastEnds ? graceUntil : activeRow.ends_at,
      now
    );
    return {
      kind: "active",
      label: pastEnds ? "Subscription grace period" : "Active subscription",
      description: pastEnds
        ? "Your paid period has ended. Paid resources stay available until the grace period finishes."
        : "You can open subscription-required resources.",
      hasLiveAccess: true,
      active: activeRow,
      pending,
      latestNonPendingApplication: latestNonPending,
      remainingDays: days,
    };
  }

  if (input.hasLiveAccess) {
    return {
      kind: "active",
      label: "Active subscription",
      description: "You can open subscription-required resources.",
      hasLiveAccess: true,
      active: activeRow,
      pending,
      latestNonPendingApplication: latestNonPending,
      remainingDays: activeRow
        ? remainingSubscriptionDays(activeRow.ends_at, now)
        : null,
    };
  }

  if (pending) {
    return {
      kind: "pending",
      label: "Application pending review",
      description:
        "Your payment proof was submitted. An admin will review it shortly. You can edit this application until it is reviewed.",
      hasLiveAccess: false,
      active: null,
      pending,
      latestNonPendingApplication: latestNonPending,
      remainingDays: null,
    };
  }

  const latestSub = sortedSubs[0] ?? null;
  if (latestSub?.status === "deactivated") {
    return {
      kind: "deactivated",
      label: "Subscription deactivated",
      description:
        "Your subscription was deactivated. Paid resources stay visible but locked. Free resources remain available.",
      hasLiveAccess: false,
      active: null,
      pending: null,
      latestNonPendingApplication: latestNonPending,
      remainingDays: null,
    };
  }

  if (
    latestSub &&
    (latestSub.status === "expired" ||
      (latestSub.status === "active" &&
        !subscriptionIsLiveAt(
          latestSub.status,
          latestSub.ends_at,
          latestSub.grace_days ?? 0,
          now
        )))
  ) {
    return {
      kind: "expired",
      label: "Subscription expired",
      description:
        "Your subscription has ended. Paid resources stay visible but locked. Free resources remain available.",
      hasLiveAccess: false,
      active: null,
      pending: null,
      latestNonPendingApplication: latestNonPending,
      remainingDays: 0,
    };
  }

  if (latestNonPending?.status === "rejected") {
    return {
      kind: "none",
      label: "No active subscription",
      description:
        "Your previous application was rejected. You can submit a new application with updated payment details.",
      hasLiveAccess: false,
      active: null,
      pending: null,
      latestNonPendingApplication: latestNonPending,
      remainingDays: null,
    };
  }

  return {
    kind: "none",
    label: "No active subscription",
    description:
      "Free resources stay available. Subscription-required resources stay visible but locked until you have an active subscription.",
    hasLiveAccess: false,
    active: null,
    pending: null,
    latestNonPendingApplication: latestNonPending,
    remainingDays: null,
  };
}

/** Edit only while pending (same rule as canStudentEditApplication). */
export function studentCanEditApplication(
  application: StudentApplicationRow | null
): boolean {
  if (!application) return false;
  return application.status === "pending";
}
