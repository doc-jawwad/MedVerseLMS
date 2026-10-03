import { requireStudent } from "@/lib/auth/require-user";
import { LeaderboardBoardCard } from "@/components/dashboard/leaderboard-board-card";
import {
  dashboardFullLimit,
  loadLastCompletedLeaderboardBoard,
} from "@/lib/leaderboard/load-last-completed-board";
import {
  LEADERBOARD_PROJECTION_LIMITS,
  type LeaderboardBoardState,
} from "@/lib/leaderboard/projection-contract";
import type { CompletedTestCandidate } from "@/lib/leaderboard/resolve-last-completed-test";
import { buildLeaderboardBoardState } from "@/lib/leaderboard/build-board-state";
import { EmptyState } from "@/components/student/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Deferred dashboard leaderboard — uses shell-passed catalog candidates.
 * Does not query /tests again.
 */
export async function DashboardLeaderboardSection({
  candidates,
  nowMs,
  viewerStudentId,
}: {
  candidates: readonly CompletedTestCandidate[];
  nowMs: number;
  viewerStudentId: string;
}) {
  let board: LeaderboardBoardState | null = null;
  let failed = false;

  try {
    const { supabase } = await requireStudent();
    board = await loadLastCompletedLeaderboardBoard(supabase, {
      candidates,
      nowMs,
      limit: dashboardFullLimit(),
    });
  } catch (err) {
    console.error("dashboard leaderboard section failed", err);
    failed = true;
    board = buildLeaderboardBoardState({
      resolved: null,
      rawRows: [],
      limit: dashboardFullLimit(),
      fetchFailed: true,
    });
  }

  if (failed || !board) {
    return (
      <Card className="surface-card border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="font-heading text-base text-ink">
            Last test leaderboard
          </CardTitle>
          <CardDescription>
            Top 5 from the most recently completed formal test.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Leaderboard unavailable"
            description="Could not load the last-test board. Refresh to try again."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <LeaderboardBoardCard
      title="Last test leaderboard"
      description="Top 5 from the most recently completed formal test. Free and paid students can view this board."
      board={board}
      viewerStudentId={viewerStudentId}
      initialDisplayCount={LEADERBOARD_PROJECTION_LIMITS.dashboardTop}
    />
  );
}
