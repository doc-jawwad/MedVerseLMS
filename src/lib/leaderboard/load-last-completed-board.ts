import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLeaderboardBoardState } from "./build-board-state.ts";
import {
  LEADERBOARD_PROJECTION_LIMITS,
  type LeaderboardBoardState,
  type LeaderboardProjectionLimit,
} from "./projection-contract.ts";
import {
  resolveLastCompletedTest,
  type CompletedTestCandidate,
} from "./resolve-last-completed-test.ts";

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

/**
 * Load Top-N board for the most recently completed catalog test via
 * `test_leaderboard_projection` (rank_test ranks only). Falls back to
 * legacy `test_leaderboard` only when the projection RPC is missing.
 */
export async function loadLastCompletedLeaderboardBoard(
  supabase: SupabaseClient,
  input: {
    candidates: readonly CompletedTestCandidate[];
    nowMs: number;
    limit: LeaderboardProjectionLimit;
  }
): Promise<LeaderboardBoardState> {
  const resolved = resolveLastCompletedTest(input.candidates, input.nowMs);
  if (!resolved) {
    return buildLeaderboardBoardState({
      resolved: null,
      rawRows: [],
      limit: input.limit,
    });
  }

  const projected = await supabase.rpc("test_leaderboard_projection", {
    p_test_id: resolved.id,
    p_limit: input.limit,
  });

  if (!projected.error) {
    return buildLeaderboardBoardState({
      resolved,
      rawRows: projected.data,
      limit: input.limit,
      fetchFailed: false,
    });
  }

  if (!rpcMissing(projected.error)) {
    return buildLeaderboardBoardState({
      resolved,
      rawRows: [],
      limit: input.limit,
      fetchFailed: true,
    });
  }

  // Compat: projection RPC not deployed yet.
  const { data, error } = await supabase.rpc("test_leaderboard", {
    p_test_id: resolved.id,
  });

  return buildLeaderboardBoardState({
    resolved,
    rawRows: data,
    limit: input.limit,
    fetchFailed: Boolean(error),
  });
}

/** Top 5 – initial collapsed view on Dashboard. */
export function dashboardTop5Limit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.dashboardTop;
}

/** Top 20 – full server fetch for Dashboard expandable board. */
export function dashboardFullLimit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.dashboardFull;
}

/** @deprecated Use dashboardTop5Limit / dashboardFullLimit. */
export function dashboardTop3Limit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.dashboardTop;
}

export function analyticsTop20Limit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.analyticsTop;
}
