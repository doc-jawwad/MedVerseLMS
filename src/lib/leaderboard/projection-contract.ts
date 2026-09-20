/**
 * Safe frontend contract for per-test leaderboard boards.
 *
 * Matches the planned `test_leaderboard_projection` shape
 * (docs/schema-lane-integration-contract.md). Ranking remains
 * `rank_test` / `test_attempts.rank` — this is presentation only.
 *
 * Privacy: never include phone, email, biodata, payment, or review content.
 */

export const LEADERBOARD_PROJECTION_LIMITS = {
  dashboardTop: 3,
  analyticsTop: 20,
} as const;

export type LeaderboardProjectionLimit =
  (typeof LEADERBOARD_PROJECTION_LIMITS)[keyof typeof LEADERBOARD_PROJECTION_LIMITS];

/** Allowed public board fields only. */
export type LeaderboardProjectionRow = {
  rank: number;
  student_id: string;
  full_name: string;
  college_name: string | null;
  avatar_object_key: string | null;
  score: number;
};

export type LeaderboardBoardEmptyReason =
  | "no_completed_test"
  | "no_ranking_yet"
  | "unavailable";

export type LeaderboardBoardState =
  | {
      status: "ready";
      testId: string;
      testTitle: string;
      closesAt: string | null;
      rows: LeaderboardProjectionRow[];
      limit: LeaderboardProjectionLimit;
    }
  | {
      status: "empty";
      reason: LeaderboardBoardEmptyReason;
      testId: string | null;
      testTitle: string | null;
      closesAt: string | null;
      limit: LeaderboardProjectionLimit;
    };

/** Keys that must never appear on a student-facing board payload. */
export const LEADERBOARD_FORBIDDEN_KEYS = [
  "phone",
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
  "correct_key",
  "explanation",
  "selected_key",
] as const;

export type LeaderboardForbiddenKey =
  (typeof LEADERBOARD_FORBIDDEN_KEYS)[number];
