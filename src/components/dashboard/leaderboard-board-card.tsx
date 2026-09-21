"use client";

import { useState } from "react";
import { User, ChevronDown, ChevronUp } from "lucide-react";
import { EmptyState } from "@/components/student/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-[var(--student-ink)]"
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
  /**
   * When provided, the card initially displays only this many rows and
   * renders a "View Full Leaderboard" toggle. When omitted or 0, all rows
   * are shown immediately.
   */
  initialDisplayCount,
}: {
  title: string;
  description?: string;
  board: LeaderboardBoardState;
  /** Highlight the viewer's row when student_id matches. */
  viewerStudentId?: string | null;
  initialDisplayCount?: number;
}) {
  const canCollapse =
    board.status === "ready" &&
    initialDisplayCount != null &&
    initialDisplayCount > 0 &&
    board.rows.length > initialDisplayCount;

  const [expanded, setExpanded] = useState(false);

  if (board.status === "empty") {
    const copy = leaderboardEmptyCopy(board.reason);
    return (
      <Card className="shadow-none" data-testid="leaderboard-board">
        <CardHeader>
          <CardTitle className="text-base text-[var(--student-ink)]">{title}</CardTitle>
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

  const displayCount =
    canCollapse && !expanded ? initialDisplayCount! : board.rows.length;
  const visibleRows = board.rows.slice(0, displayCount);
  const badgeLabel = `Top ${displayCount}`;

  return (
    <Card className="shadow-none" data-testid="leaderboard-board">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base text-[var(--student-ink)]">{title}</CardTitle>
          <Badge variant="secondary" data-testid="leaderboard-limit-badge">
            {badgeLabel}
          </Badge>
        </div>
        <CardDescription>
          {description ??
            "Ranked by formal test score (rank_test). Visible to free and paid students."}
        </CardDescription>
        <p className="text-sm font-medium text-[var(--student-ink)]">{board.testTitle}</p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {visibleRows.map((row) => {
          const isMe =
            viewerStudentId != null && row.student_id === viewerStudentId;
          return (
            <div
              key={`${row.student_id}-${row.rank}`}
              className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
              data-testid="leaderboard-row"
              data-rank={row.rank}
            >
              <span className="w-7 shrink-0 text-center font-heading text-lg font-semibold text-[var(--student-ink)]">
                {row.rank}
              </span>
              <AvatarPlaceholder name={row.full_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--student-ink)]">
                  {row.full_name}
                  {isMe ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--brand-teal-ink)]">
                      you
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.college_name?.trim() || "College not set"}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--student-ink)]">
                {row.score}
              </span>
            </div>
          );
        })}

        {canCollapse && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-[var(--brand-teal-ink)] hover:text-[var(--brand-teal-ink)]"
            onClick={() => setExpanded((v) => !v)}
            data-testid="leaderboard-toggle"
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1.5 size-4" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="mr-1.5 size-4" />
                View Full Leaderboard
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
