import { User } from "lucide-react";
import { EmptyState } from "@/components/student/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { leaderboardEmptyCopy } from "@/lib/leaderboard/build-board-state";
import type { LeaderboardBoardState } from "@/lib/leaderboard/projection-contract";

function AvatarPlaceholder({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#072855]/10 text-sm font-semibold text-[#072855]"
      aria-hidden
    >
      {initial || <User className="size-4" />}
    </span>
  );
}

export function LeaderboardBoardCard({
  title,
  description,
  board,
  viewerStudentId,
}: {
  title: string;
  description?: string;
  board: LeaderboardBoardState;
  /** Highlight the viewer's row when student_id matches. */
  viewerStudentId?: string | null;
}) {
  if (board.status === "empty") {
    const copy = leaderboardEmptyCopy(board.reason);
    return (
      <Card className="shadow-none" data-testid="leaderboard-board">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          {board.testTitle && (
            <CardDescription>{board.testTitle}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <EmptyState title={copy.title} description={copy.description} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none" data-testid="leaderboard-board">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base text-[#072855]">{title}</CardTitle>
          <Badge variant="secondary">Top {board.limit}</Badge>
        </div>
        <CardDescription>
          {description ??
            "Ranked by formal test score (rank_test). Visible to free and paid students."}
        </CardDescription>
        <p className="text-sm font-medium text-[#072855]">{board.testTitle}</p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {board.rows.map((row) => {
          const isMe =
            viewerStudentId != null && row.student_id === viewerStudentId;
          return (
            <div
              key={`${row.student_id}-${row.rank}`}
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              data-testid="leaderboard-row"
              data-rank={row.rank}
            >
              <span className="w-7 shrink-0 text-center font-heading text-lg font-semibold text-[#072855]">
                {row.rank}
              </span>
              <AvatarPlaceholder name={row.full_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#072855]">
                  {row.full_name}
                  {isMe ? (
                    <span className="ml-1.5 text-xs font-normal text-[#05AEA9]">
                      you
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.college_name?.trim() || "College not set"}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums text-[#072855]">
                {row.score}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
