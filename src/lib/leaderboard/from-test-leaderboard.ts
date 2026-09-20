/**
 * Adapter: existing `test_leaderboard` RPC → projection contract.
 * Does not re-rank. Does not invent college/avatar when absent.
 */

import {
  LEADERBOARD_FORBIDDEN_KEYS,
  type LeaderboardProjectionLimit,
  type LeaderboardProjectionRow,
} from "./projection-contract.ts";

/** Raw row shape from today's `test_leaderboard` DEFINER RPC. */
export type TestLeaderboardRpcRow = {
  rank: number | null;
  percentile?: number | null;
  student_id: string;
  full_name: string | null;
  score: number | string | null;
  max_score?: number | string | null;
  percentage?: number | string | null;
  is_me?: boolean;
  /** Future projection fields — pass-through when present. */
  college_name?: string | null;
  avatar_object_key?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Strip forbidden private keys from an unknown payload before adapting.
 * Returns a shallow copy with only non-forbidden keys.
 */
export function stripLeaderboardPrivateFields(
  raw: unknown
): Record<string, unknown> | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const out: Record<string, unknown> = {};
  const forbidden = new Set<string>(LEADERBOARD_FORBIDDEN_KEYS);
  for (const [key, value] of Object.entries(rec)) {
    if (forbidden.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function adaptTestLeaderboardRow(
  raw: unknown
): LeaderboardProjectionRow | null {
  const cleaned = stripLeaderboardPrivateFields(raw);
  if (!cleaned) return null;

  const rank = asFiniteNumber(cleaned.rank);
  const studentId = asNonEmptyString(cleaned.student_id);
  const fullName = asNonEmptyString(cleaned.full_name) ?? "Student";
  const score = asFiniteNumber(cleaned.score);
  if (rank == null || rank < 1 || !studentId || score == null) return null;

  const college = asNonEmptyString(cleaned.college_name);
  const avatar = asNonEmptyString(cleaned.avatar_object_key);

  return {
    rank: Math.trunc(rank),
    student_id: studentId,
    full_name: fullName,
    college_name: college,
    avatar_object_key: avatar,
    score,
  };
}

/**
 * Map RPC rows → projection rows, preserve rank order, slice to limit.
 * Never re-sorts by score (rank_test order is authoritative).
 */
export function adaptTestLeaderboardRows(
  rawRows: unknown,
  limit: LeaderboardProjectionLimit
): LeaderboardProjectionRow[] {
  if (!Array.isArray(rawRows)) return [];
  const rows: LeaderboardProjectionRow[] = [];
  for (const item of rawRows) {
    const row = adaptTestLeaderboardRow(item);
    if (row) rows.push(row);
  }
  return rows.slice(0, limit);
}

/** True when a projection row still carries a forbidden key (defensive). */
export function projectionRowHasForbiddenKey(
  row: LeaderboardProjectionRow
): boolean {
  const keys = Object.keys(row);
  return LEADERBOARD_FORBIDDEN_KEYS.some((k) => keys.includes(k));
}
