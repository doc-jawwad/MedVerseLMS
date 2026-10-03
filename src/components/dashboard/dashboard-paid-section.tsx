import { requireStudent } from "@/lib/auth/require-user";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import { PERFORMANCE_GRAIN_COPY } from "@/lib/tests/student-dashboard-presentation";
import { ProgressBar } from "@/components/student/progress-bar";
import { StatusBadge } from "@/components/student/status-badge";
import { EmptyState } from "@/components/student/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SubjectPerf = {
  subject_id: string;
  subject_name: string;
  test_average_percentage: number;
  tests_taken: number;
  practice_accuracy: number;
  practice_answered: number;
};

type WeakChapter = {
  chapter_id: string;
  chapter_name: string;
  subject_name: string;
  accuracy: number;
  answered: number;
};

/**
 * Deferred paid-only analytics. Re-checks live access before any paid RPC.
 * Free / non-live students must never reach student_subject_performance /
 * student_weak_chapters from this component.
 */
export async function DashboardPaidSection() {
  let failed = false;
  let subjectRows: SubjectPerf[] = [];
  let weakRows: WeakChapter[] = [];
  let allowed = false;

  try {
    const { supabase } = await requireStudent();
    const hasLiveAccess = await getStudentHasLiveSubscription();
    allowed = studentHasPaidLmsSections(hasLiveAccess);
    if (allowed) {
      const [{ data: subjects }, { data: weak }] = await Promise.all([
        supabase.rpc("student_subject_performance"),
        supabase.rpc("student_weak_chapters", { p_limit: 5 }),
      ]);
      subjectRows = (subjects ?? []) as SubjectPerf[];
      weakRows = (weak ?? []) as WeakChapter[];
    }
  } catch (err) {
    console.error("dashboard paid section failed", err);
    failed = true;
  }

  if (failed) {
    return (
      <EmptyState
        title="Paid analytics unavailable"
        description="Could not load subject performance. Refresh to try again."
      />
    );
  }

  if (!allowed || (subjectRows.length === 0 && weakRows.length === 0)) {
    return null;
  }

  return (
    <div className="grid gap-3" data-testid="dashboard-paid-analytics">
      {subjectRows.length > 0 && (
        <Card className="surface-card border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="font-heading text-base text-ink">
              Subject performance
            </CardTitle>
            <CardDescription>{PERFORMANCE_GRAIN_COPY.subject}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {subjectRows.map((sub) => (
              <div key={sub.subject_id} className="grid gap-3">
                <p className="text-sm font-semibold text-ink">
                  {sub.subject_name}
                </p>
                <ProgressBar
                  label={`Tests (${sub.tests_taken})`}
                  value={sub.test_average_percentage}
                />
                <ProgressBar
                  label={`Practice (${sub.practice_answered} answered)`}
                  value={sub.practice_accuracy}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {weakRows.length > 0 && (
        <Card className="surface-card border-border/80 shadow-none">
          <CardHeader>
            <CardTitle className="font-heading text-base text-ink">
              Weak chapters
            </CardTitle>
            <CardDescription>
              {PERFORMANCE_GRAIN_COPY.weakChapters}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {weakRows.map((w) => (
              <div
                key={w.chapter_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2 text-sm"
              >
                <span>
                  {w.chapter_name}{" "}
                  <span className="text-muted-foreground">
                    ({w.subject_name})
                  </span>
                </span>
                <StatusBadge tone={w.accuracy < 50 ? "danger" : "warning"}>
                  {w.accuracy}% ({w.answered})
                </StatusBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
