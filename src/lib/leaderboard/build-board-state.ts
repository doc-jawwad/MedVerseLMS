/**
 * Build a Top-N board state from a resolved completed test + RPC rows.
 * Empty reasons are explicit — never invent placeholder students.
 */

import { adaptTestLeaderboardRows } from "./from-test-leaderboard.ts";
import type {
  LeaderboardBoardEmptyReason,
  LeaderboardBoardState,
  LeaderboardProjectionLimit,
} from "./projection-contract.ts";
import type { ResolvedCompletedTest } from "./resolve-last-completed-test.ts";

export function buildLeaderboardBoardState(input: {
  resolved: ResolvedCompletedTest | null;
  rawRows: unknown;
  limit: LeaderboardProjectionLimit;
  /**
   * When the RPC errored or view gate returned no rows while ranks may exist,
   * surface `unavailable` instead of inventing data.
   */
  fetchFailed?: boolean;
}): LeaderboardBoardState {
  const { resolved, limit } = input;

  if (!resolved) {
    return {
      status: "empty",
      reason: "no_completed_test",
      testId: null,
      testTitle: null,
      closesAt: null,
      limit,
    };
  }

  if (input.fetchFailed) {
    return {
      status: "empty",
      reason: "unavailable",
      testId: resolved.id,
      testTitle: resolved.title,
      closesAt: resolved.closesAt,
      limit,
    };
  }

  const rows = adaptTestLeaderboardRows(input.rawRows, limit);
  if (rows.length === 0) {
    return {
      status: "empty",
      reason: "no_ranking_yet",
      testId: resolved.id,
      testTitle: resolved.title,
      closesAt: resolved.closesAt,
      limit,
    };
  }

  return {
    status: "ready",
    testId: resolved.id,
    testTitle: resolved.title,
    closesAt: resolved.closesAt,
    rows,
    limit,
  };
}

export function leaderboardEmptyCopy(reason: LeaderboardBoardEmptyReason): {
  title: string;
  description: string;
} {
  switch (reason) {
    case "no_completed_test":
      return {
        title: "No completed test yet",
        description:
          "When a formal test window closes and rankings are ready, the board will appear here.",
      };
    case "no_ranking_yet":
      return {
        title: "No ranking yet",
        description:
          "This test has closed, but ranks are not available yet — or no submissions were ranked.",
      };
    case "unavailable":
      return {
        title: "Leaderboard unavailable",
        description:
          "The board could not be loaded right now. Your own results stay on Tests when you have submitted.",
      };
  }
}
