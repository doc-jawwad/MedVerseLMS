import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Mock Tests — MedVerse" };

type MockTest = {
  test_id: string;
  title: string;
  subject_id: string;
  subject_name: string;
  product_key: string | null;
  status: string;
  duration_minutes: number;
  question_count: number;
  my_attempt_state: string | null;
};

const attemptVariant: Record<string, "default" | "secondary" | "outline"> = {
  submitted: "default",
  in_progress: "secondary",
};

export default async function MockTestPage() {
  const supabase = await createClient();

  // Auth check — student must be signed in (middleware also enforces paid section).
  await requireUser();

  const { data, error } = await supabase.rpc("list_student_mock_tests");

  if (error) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Could not load mock tests. Please try again later.
      </div>
    );
  }

  const tests = (data ?? []) as MockTest[];

  // Group by subject
  const bySubject = new Map<string, { subject_name: string; tests: MockTest[] }>();
  for (const t of tests) {
    if (!bySubject.has(t.subject_id)) {
      bySubject.set(t.subject_id, { subject_name: t.subject_name, tests: [] });
    }
    bySubject.get(t.subject_id)!.tests.push(t);
  }

  return (
    <div className="grid gap-8 px-4 py-8 sm:px-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          Practice
        </p>
        <h1 className="font-heading text-3xl font-bold text-[var(--student-ink)]">
          Mock Tests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Practice assessments — attempt anytime, no competitive ranking.
        </p>
      </div>

      {tests.length === 0 && (
        <div className="rounded-xl border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No mock tests are available for your class yet.
          </p>
        </div>
      )}

      {Array.from(bySubject.entries()).map(([subjectId, { subject_name, tests: subTests }]) => (
        <div key={subjectId} className="grid gap-3">
          <h2 className="font-semibold text-lg text-[var(--student-ink)]">{subject_name}</h2>
          <div className="grid gap-2">
            {subTests.map((t) => (
              <div
                key={t.test_id}
                className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
              >
                <div className="grid gap-0.5">
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.duration_minutes} min · {t.question_count} questions
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {t.my_attempt_state && (
                    <Badge variant={attemptVariant[t.my_attempt_state] ?? "outline"}>
                      {t.my_attempt_state}
                    </Badge>
                  )}
                  <Button asChild size="sm">
                    <Link href={`/tests/${t.test_id}/attempt`}>
                      {t.my_attempt_state === "in_progress"
                        ? "Resume"
                        : t.my_attempt_state === "submitted"
                        ? "Review"
                        : "Start"}
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
