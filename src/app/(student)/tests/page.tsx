import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Tests — MedVerse LMS" };

export default async function StudentTestsPage() {
  const { supabase, userId } = await requireStudent();

  const [{ data: tests }, { data: attempts }] = await Promise.all([
    supabase
      .from("tests")
      .select(
        "id, title, status, opens_at, closes_at, duration_minutes, subjects(name), test_questions(count)"
      )
      .order("opens_at", { ascending: false }),
    supabase
      .from("test_attempts")
      .select("id, test_id, state, score, max_score, percentage, rank, submitted_at")
      .eq("student_id", userId)
      .neq("state", "invalidated"),
  ]);

  const now = Date.now();
  const rows = (tests ?? []).map((t) => {
    const attempt = (attempts ?? []).find((a) => a.test_id === t.id);
    const opens = t.opens_at ? new Date(t.opens_at).getTime() : 0;
    const closes = t.closes_at ? new Date(t.closes_at).getTime() : 0;
    let kind: "upcoming" | "available" | "previous";
    if (attempt?.state === "submitted" || t.status === "closed" || now >= closes) {
      kind = "previous";
    } else if (now < opens) {
      kind = "upcoming";
    } else {
      kind = "available";
    }
    return { t, attempt, kind };
  });

  const sections = [
    { key: "available", label: "Available now" },
    { key: "upcoming", label: "Upcoming" },
    { key: "previous", label: "Previous" },
  ] as const;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Tests</h1>

      {sections.map((sec) => {
        const items = rows.filter((r) => r.kind === sec.key);
        if (items.length === 0) return null;
        return (
          <div key={sec.key} className="grid gap-3">
            <h2 className="font-medium text-muted-foreground">{sec.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(({ t, attempt }) => {
                const s = t.subjects as unknown as { name: string } | null;
                const qc =
                  (t.test_questions as unknown as { count: number }[])?.[0]
                    ?.count ?? 0;
                return (
                  <Card key={t.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{t.title}</CardTitle>
                      <CardDescription>
                        {s?.name && `${s.name} · `}
                        {qc} MCQs · {t.duration_minutes} minutes
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2 text-sm">
                      <p className="text-muted-foreground">
                        {t.opens_at && (
                          <>Opens: {new Date(t.opens_at).toLocaleString()}<br /></>
                        )}
                        {t.closes_at && (
                          <>Closes: {new Date(t.closes_at).toLocaleString()}</>
                        )}
                      </p>
                      {sec.key === "available" && (
                        <Button asChild className="w-fit">
                          <Link href={`/tests/${t.id}/attempt`}>
                            {attempt?.state === "in_progress"
                              ? "Resume test"
                              : "Start test"}
                          </Link>
                        </Button>
                      )}
                      {sec.key === "upcoming" && (
                        <Badge variant="secondary" className="w-fit">
                          Not open yet
                        </Badge>
                      )}
                      {sec.key === "previous" &&
                        (attempt?.state === "submitted" ? (
                          <div className="flex items-center gap-3">
                            <Badge>
                              {attempt.score}/{attempt.max_score} (
                              {attempt.percentage}%)
                            </Badge>
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/tests/${t.id}/result`}>
                                View result
                              </Link>
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="outline" className="w-fit">
                            Not attempted
                          </Badge>
                        ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && (
        <p className="text-muted-foreground">No tests assigned to you yet.</p>
      )}
    </div>
  );
}
