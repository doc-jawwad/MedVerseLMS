/**
 * Admin-only overlay on existing test_leaderboard ranks.
 * Does not re-rank, re-sort, or change scores. Student-facing boards must
 * keep using the public projection (name / college / score) only.
 */

import {
  enrollmentClassLabel,
  pickLiveEnrollment,
  yearNameFromEnrollment,
  type EnrollmentRow,
} from "../admin/student-account-ui.ts";

/** Rank row from `test_leaderboard` — ranking source of truth. */
export type TestLeaderboardRankRow = {
  rank: number | null;
  percentile: number | null;
  student_id: string;
  full_name: string;
  score: number;
  max_score: number;
  percentage: number;
  is_me: boolean;
};

/** Existing profile/enrollment fields appropriate for an admin board. */
export type AdminLeaderboardStudentDetail = {
  college_name: string | null;
  email: string | null;
  account_status: string | null;
  class_name: string | null;
  class_status: string | null;
};

export type AdminLeaderboardRow = TestLeaderboardRankRow &
  AdminLeaderboardStudentDetail;

export type AdminLeaderboardProfileSource = {
  id: string;
  college_name?: string | null;
  email?: string | null;
  account_status?: string | null;
  enrollments?: EnrollmentRow[] | null;
};

const EMPTY_DETAIL: AdminLeaderboardStudentDetail = {
  college_name: null,
  email: null,
  account_status: null,
  class_name: null,
  class_status: null,
};

export function mapAdminLeaderboardProfile(
  profile: AdminLeaderboardProfileSource
): AdminLeaderboardStudentDetail {
  const live = pickLiveEnrollment(profile.enrollments ?? null);
  const className = yearNameFromEnrollment(live);
  return {
    college_name: profile.college_name?.trim() || null,
    email: profile.email?.trim() || null,
    account_status: profile.account_status ?? null,
    class_name: className === "—" ? null : className,
    class_status: live ? enrollmentClassLabel(live.status) : null,
  };
}

export function mapAdminLeaderboardProfiles(
  profiles: AdminLeaderboardProfileSource[]
): Map<string, AdminLeaderboardStudentDetail> {
  const map = new Map<string, AdminLeaderboardStudentDetail>();
  for (const profile of profiles) {
    map.set(profile.id, mapAdminLeaderboardProfile(profile));
  }
  return map;
}

/**
 * Overlay admin fields onto rank rows. Order, rank, and marks stay as given.
 * Extra keys on the detail map (phone, payment, …) are ignored.
 */
export function attachAdminStudentDetails(
  ranks: TestLeaderboardRankRow[],
  detailsByStudentId: Map<string, AdminLeaderboardStudentDetail>
): AdminLeaderboardRow[] {
  return ranks.map((row) => {
    const extra = detailsByStudentId.get(row.student_id) ?? EMPTY_DETAIL;
    return {
      rank: row.rank,
      percentile: row.percentile,
      student_id: row.student_id,
      full_name: row.full_name,
      score: row.score,
      max_score: row.max_score,
      percentage: row.percentage,
      is_me: row.is_me,
      college_name: extra.college_name,
      email: extra.email,
      account_status: extra.account_status,
      class_name: extra.class_name,
      class_status: extra.class_status,
    };
  });
}
