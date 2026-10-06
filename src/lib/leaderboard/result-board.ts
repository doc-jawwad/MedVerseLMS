/**
 * Student result-page leaderboard: keep test_leaderboard ranks/marks and
 * attach college from the student-safe projection. Does not re-rank.
 */

export type ResultLeaderboardRankRow = {
  rank: number | null;
  student_id: string;
  full_name: string;
  score: number;
  max_score: number;
  percentage: number;
  is_me: boolean;
};

export type ResultLeaderboardRow = {
  rank: number | null;
  full_name: string;
  college_name: string | null;
  score: number;
  max_score: number;
  percentage: number;
  is_me: boolean;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function collegeByStudentId(projectionRows: unknown): Map<string, string | null> {
  const map = new Map<string, string | null>();
  if (!Array.isArray(projectionRows)) return map;
  for (const item of projectionRows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = asNonEmptyString(rec.student_id);
    if (!id) continue;
    map.set(id, asNonEmptyString(rec.college_name));
  }
  return map;
}

/**
 * Overlay college_name onto rank rows. Order, rank, score, and percentage
 * stay as given. Extra projection keys (email, account_status, …) are ignored.
 */
export function attachCollegeToResultLeaderboard(
  ranks: ResultLeaderboardRankRow[],
  projectionRows: unknown
): ResultLeaderboardRow[] {
  const colleges = collegeByStudentId(projectionRows);
  return ranks.map((row) => ({
    rank: row.rank,
    full_name: row.full_name,
    college_name: colleges.get(row.student_id) ?? null,
    score: row.score,
    max_score: row.max_score,
    percentage: row.percentage,
    is_me: row.is_me,
  }));
}
