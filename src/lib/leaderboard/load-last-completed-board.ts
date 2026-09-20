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

/**
 * Load Top-N board for the most recently completed catalog test via
 * existing `test_leaderboard` (rank_test-backed). Adapts to the future
 * projection contract. No second ranking query.
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

export function dashboardTop3Limit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.dashboardTop;
}

export function analyticsTop20Limit(): LeaderboardProjectionLimit {
  return LEADERBOARD_PROJECTION_LIMITS.analyticsTop;
}
