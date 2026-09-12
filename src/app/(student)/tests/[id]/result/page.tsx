import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Result — MedVerse LMS" };

type ReviewItem = {
  idx: number;
  stem: string;
  options: { key: string; text: string }[];
  correct_key: string;
  explanation: string;
  reference: string;
  selected_key: string | null;
  voided: boolean;
  void_policy: string | null;
};

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase, userId } = await requireStudent();
  const { id } = await params;

  const [{ data: test }, { data: attempts }] = await Promise.all([
    supabase
      .from("tests")
      .select("id, title, closes_at, show_review, negative_mark")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("test_attempts")
      .select(
        "id, state, score, max_score, raw_correct, raw_wrong, raw_blank, percentage, rank, percentile, submitted_at, submit_source, invalidated_reason"
      )
      .eq("test_id", id)
      .eq("student_id", userId)
      .order("created_at", { ascending: true }),
  ]);
  if (!test) notFound();

  const submitted = (attempts ?? []).find((a) => a.state === "submitted");
  const invalidated = (attempts ?? []).filter((a) => a.state === "invalidated");

  type Review = { allowed: boolean; reason?: string; items?: ReviewItem[] };
  let review: Review | null = null;
  type LeaderRow = {
    rank: number;
    percentile: number | null;
    full_name: string;
    score: number;
    max_score: number;
    percentage: number;
    is_me: boolean;
  };
  let leaderboard: LeaderRow[] = [];
  if (submitted) {
    const [{ data: reviewData }, { data: lbData }] = await Promise.all([
      supabase.rpc("get_attempt_review", { p_attempt_id: submitted.id }),
      supabase.rpc("test_leaderboard", { p_test_id: id }),
    ]);
    review = (reviewData as Review | null) ?? null;
    leaderboard = (lbData as LeaderRow[] | null) ?? [];
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{test.title}</h1>
        <p className="text-muted-foreground">Your result</p>
      </div>

      {invalidated.map((a) => (
        <p key={a.id} className="text-sm text-muted-foreground">
          A previous attempt was invalidated
          {a.invalidated_reason ? ` (${a.invalidated_reason})` : ""}.
        </p>
      ))}

      {!submitted ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {invalidated.length > 0 ? "No valid result" : "No submitted attempt"}
            </CardTitle>
            <CardDescription>
              {invalidated.length > 0
                ? "Your attempt on this test was invalidated by an admin — see the reason above. Ask your admin if you should be allowed a fresh attempt."
                : "You haven't completed this test."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/tests">Back to tests</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Score" value={`${submitted.score} / ${submitted.max_score}`} />
            <Stat label="Percentage" value={`${submitted.percentage}%`} />
            <Stat label="Correct" value={String(submitted.raw_correct)} />
            <Stat
              label="Wrong / Blank"
              value={`${submitted.raw_wrong} / ${submitted.raw_blank}`}
            />
          </div>
          {submitted.rank != null && (
            <div className="grid grid-cols-2 gap-3 sm:w-1/2">
              <Stat label="Rank" value={`#${submitted.rank}`} />
              <Stat
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
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Leaderboard</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1">
                {leaderboard.map((r) => (
                  <div
                    key={r.rank}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                      r.is_me ? "bg-accent font-medium" : ""
                    }`}
                  >
                    <span>
                      #{r.rank} {r.is_me ? "YOU" : r.full_name}
                    </span>
                    <span className="text-muted-foreground">
                      {r.score}/{r.max_score} ({r.percentage}%)
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {review && !review.allowed && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {review.reason === "review_disabled"
                  ? "Answer review is not available for this test."
                  : `Answers and explanations become visible after the test closes (${formatDateTime(test.closes_at)}).`}
              </CardContent>
            </Card>
          )}

          {review?.allowed && review.items && (
            <div className="grid gap-4">
              <h2 className="text-lg font-medium">Question review</h2>
              {review.items.map((item) => {
                const status = item.voided
                  ? "voided"
                  : !item.selected_key
                    ? "blank"
                    : item.selected_key === item.correct_key
                      ? "correct"
                      : "wrong";
                return (
                  <Card key={item.idx}>
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
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
