import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import {
  resultReviewUiState,
  type AttemptReviewPayloadIncoming,
} from "@/lib/tests/attempt-review";
import { parseOwnTestResult } from "@/lib/tests/own-test-result";
import {
  attachCollegeToResultLeaderboard,
  type ResultLeaderboardRankRow,
} from "@/lib/leaderboard/result-board";
import { normalizeLeaderboardRpcRows } from "@/lib/leaderboard/load-last-completed-board";
import { ReviewLockNotice } from "@/components/subscription/review-lock-notice";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { StatTile } from "@/components/student/stat-tile";
import {
  bindSsrTiming,
  ssrMarkPageFnEnd,
  ssrSpan,
  ssrSpanSync,
} from "@/lib/observability/ssr-timing-rsc";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Result — MedVerse LMS" };
export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  await bindSsrTiming("/tests/id/result");
  const { supabase } = await requireStudent();
  const { id } = await params;

  const { data: ownRaw, error: ownError } = await ssrSpan(
    "fetch.get_own_test_result",
    () => supabase.rpc("get_own_test_result", { p_test_id: id })
  );
  const own = ssrSpanSync("in_process.parse_result", () =>
    parseOwnTestResult(ownRaw)
  );
  if (ownError || !own) {
    ssrMarkPageFnEnd();
    notFound();
  }

  const { test, attempt: submitted, invalidated } = own;

  const [{ data: reviewData }, { data: lbData }, { data: projectedData }] =
    await Promise.all([
      ssrSpan("fetch.get_attempt_review", () =>
        supabase.rpc("get_attempt_review", { p_attempt_id: submitted.id })
      ),
      ssrSpan("fetch.test_leaderboard", () =>
        supabase.rpc("test_leaderboard", { p_test_id: id })
      ),
      ssrSpan("fetch.test_leaderboard_projection", () =>
        supabase.rpc("test_leaderboard_projection", {
          p_test_id: id,
          p_limit: 100,
        })
      ),
    ]);
  const reviewState = ssrSpanSync("in_process.review_ui", () =>
    resultReviewUiState(reviewData as AttemptReviewPayloadIncoming | null)
  );
  const leaderboard = attachCollegeToResultLeaderboard(
    (lbData as ResultLeaderboardRankRow[] | null) ?? [],
    normalizeLeaderboardRpcRows(projectedData)
  );
  ssrMarkPageFnEnd();

  return (
    <StudentPage width="article">
      <PageHeader title={test.title} description="Your result" />

      {invalidated.map((a) => (
        <p key={a.id} className="text-sm text-muted-foreground">
          A previous attempt was invalidated
          {a.invalidated_reason ? ` (${a.invalidated_reason})` : ""}.
        </p>
      ))}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="result-summary">
        <StatTile label="Score" value={`${submitted.score} / ${submitted.max_score}`} />
        <StatTile label="Percentage" value={`${submitted.percentage}%`} />
        <StatTile label="Correct" value={String(submitted.raw_correct)} />
        <StatTile
          label="Wrong / Blank"
          value={`${submitted.raw_wrong} / ${submitted.raw_blank}`}
        />
      </div>
      {submitted.rank != null && (
        <div className="grid grid-cols-2 gap-3 sm:w-1/2">
          <StatTile label="Rank" value={`#${submitted.rank}`} />
          <StatTile
            label="Percentile"
            value={submitted.percentile != null ? `${submitted.percentile}` : "—"}
          />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Submitted {submitted.submitted_at && formatDateTime(submitted.submitted_at)}
        {submitted.submit_source === "auto" && " (auto-submitted at time expiry)"}
        {Number(test.negative_mark) > 0 &&
          ` · negative marking −${test.negative_mark} per wrong answer`}
      </p>

      {leaderboard.length > 0 && (
        <Card className="shadow-none" data-testid="result-leaderboard">
          <CardHeader>
            <CardTitle className="text-base text-[var(--student-ink)]">Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {leaderboard.map((r, idx) => (
              <div
                key={`${r.full_name}-${r.rank ?? "x"}-${idx}`}
                className={`flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${
                  r.is_me ? "bg-accent font-medium" : ""
                }`}
                data-testid="result-leaderboard-row"
              >
                <div className="min-w-0">
                  <p className="truncate">
                    #{r.rank} {r.is_me ? "YOU" : r.full_name}
                  </p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {r.college_name ?? "College not set"}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {r.score}/{r.max_score} ({r.percentage}%)
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {reviewState.kind === "entitlement_lock" && (
        <div className="grid gap-3">
          <h2 className="text-lg font-medium">Question review</h2>
          <ReviewLockNotice />
        </div>
      )}

      {reviewState.kind === "disabled" && (
        <Card className="shadow-none">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Answer review is not available for this test.
          </CardContent>
        </Card>
      )}

      {reviewState.kind === "after_close" && (
        <Card className="shadow-none">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {`Answers and explanations become visible after the test closes (${formatDateTime(test.closes_at)}).`}
          </CardContent>
        </Card>
      )}

      {reviewState.kind === "open" && (
        <div className="grid gap-4">
          <h2 className="text-lg font-medium">Question review</h2>
          {reviewState.items.map((item) => {
            const status = item.voided
              ? "voided"
              : !item.selected_key
                ? "blank"
                : item.selected_key === item.correct_key
                  ? "correct"
                  : "wrong";
            return (
              <Card key={item.idx} className="shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-start justify-between gap-2 text-base font-medium">
                    <span>
                      {item.idx}. {item.stem}
                    </span>
                    <Badge
                      variant={
                        status === "correct"
                          ? "default"
                          : status === "wrong"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {status === "correct" && "✓ correct"}
                      {status === "wrong" && "✗ wrong"}
                      {status === "blank" && "— unattempted"}
                      {status === "voided" && `voided (${item.void_policy})`}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {item.options.map((o) => (
                    <div
                      key={o.key}
                      className={`rounded-md border p-2 text-sm ${
                        o.key === item.correct_key
                          ? "border-green-600 bg-green-50 dark:bg-green-950"
                          : o.key === item.selected_key
                            ? "border-red-500 bg-red-50 dark:bg-red-950"
                            : ""
                      }`}
                    >
                      <span className="mr-2 font-semibold">{o.key}.</span>
                      {o.text}
                      {o.key === item.selected_key && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          your answer
                        </span>
                      )}
                    </div>
                  ))}
                  {item.explanation && (
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {item.explanation}
                    </p>
                  )}
                  {item.reference && (
                    <p className="text-xs text-muted-foreground">
                      Reference: {item.reference}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </StudentPage>
  );
}
