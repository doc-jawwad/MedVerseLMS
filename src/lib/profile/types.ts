/**
 * Profile / class-lock domain types for the Profile UI lane.
 * Schema lane owns migrations; fields marked planned may live in
 * Auth user_metadata until profiles columns / RPCs ship.
 */

export type ClassLockKind =
  | "free"
  | "pending_application"
  | "active_subscription";

export type YearOption = {
  id: string;
  year_number: number;
  name: string;
};

/** Own profile — includes private contact fields. Never send to other students. */
export type StudentProfile = {
  id: string;
  full_name: string;
  email: string;
  /** Planned: profiles.contact_number or metadata until migration. */
  contact_number: string | null;
  /** profiles.college_name (leaderboard-authoritative; metadata is bootstrap only). */
  college_name: string | null;
  /** Planned: profiles.avatar_object_key (private R2). */
  avatar_object_key: string | null;
  /** Signed GET URL when available; never a permanent public URL. */
  avatar_url: string | null;
  current_year_id: string | null;
  current_year_name: string | null;
  current_year_number: number | null;
  enrollment_status: string | null;
};

/** Leaderboard-safe identity only — name, college, avatar. No phone/email/biodata/payment. */
export type LeaderboardSafeIdentity = {
  student_id: string;
  full_name: string;
  college_name: string | null;
  avatar_object_key: string | null;
};

export type ClassLockState = {
  year_id: string | null;
  year_number: number | null;
  year_name: string | null;
  lock: ClassLockKind;
  can_self_change: boolean;
  subscription_year_id: string | null;
  subscription_year_name: string | null;
  pending_application_id: string | null;
  pending_application_year_id: string | null;
  pending_application_year_name: string | null;
};

export type ProfileUpdateInput = {
  full_name?: string;
  contact_number?: string | null;
  college_name?: string | null;
};

export type PurchaseClassConfirmation = {
  year_id: string;
  year_name: string;
  confirmed: boolean;
};

export type YearChangeRequestView = {
  id: string;
  status: string;
  reason: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  from_year_id: string;
  to_year_id: string;
  from_name: string | null;
  to_name: string | null;
};
