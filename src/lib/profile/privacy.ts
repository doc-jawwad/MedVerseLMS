import type {
  LeaderboardSafeIdentity,
  StudentProfile,
} from "@/lib/profile/types";

/** Keys that must never appear on cross-student / board payloads. */
export const PROFILE_PRIVATE_KEYS = [
  "phone",
  "contact_number",
  "email",
  "biodata",
  "payment",
  "payment_proof",
  "amount",
  "currency",
  "bank",
  "cnic",
  "national_id",
  "address",
  "date_of_birth",
  "dob",
] as const;

export type ProfilePrivateKey = (typeof PROFILE_PRIVATE_KEYS)[number];

/**
 * Leaderboard-safe identity: name, college, avatar only.
 * Other students must never see phone, email, biodata, or payment info.
 */
export function toLeaderboardSafeIdentity(
  profile: Pick<
    StudentProfile,
    "id" | "full_name" | "college_name" | "avatar_object_key"
  >
): LeaderboardSafeIdentity {
  return {
    student_id: profile.id,
    full_name: profile.full_name,
    college_name: profile.college_name,
    avatar_object_key: profile.avatar_object_key,
  };
}

export function stripPrivateProfileFields<T extends Record<string, unknown>>(
  row: T
): Omit<T, ProfilePrivateKey> {
  const next = { ...row };
  for (const key of PROFILE_PRIVATE_KEYS) {
    if (key in next) {
      delete (next as Record<string, unknown>)[key];
    }
  }
  return next as Omit<T, ProfilePrivateKey>;
}

export function assertNoPrivateKeys(
  payload: Record<string, unknown>
): string[] {
  return PROFILE_PRIVATE_KEYS.filter((k) => k in payload && payload[k] != null);
}
