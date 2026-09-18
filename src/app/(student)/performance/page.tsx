import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PERFORMANCE_GRAIN_COPY } from "@/lib/tests/student-dashboard-presentation";

export const metadata = { title: "Performance — MedVerse LMS" };

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

type TrendPoint = {
  test_id: string;
  title: string;
  percentage: number;
  submitted_at: string;
};

function Bar({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value}% {sub}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export default async function PerformancePage() {
  const { supabase } = await requireStudent();

  const [{ data: summary }, { data: subjects }, { data: weak }, { data: trend }] =
    await Promise.all([
      supabase.rpc("student_test_summary"),
      supabase.rpc("student_subject_performance"),
      supabase.rpc("student_weak_chapters", { p_limit: 5 }),
      supabase.rpc("student_trend"),
    ]);

  const s = summary as {
    tests_taken: number;
    average_percentage: number;
    best_percentage: number;
    average_rank: number;
  } | null;
  const subjectRows = (subjects ?? []) as SubjectPerf[];
  const weakRows = (weak ?? []) as WeakChapter[];
  const trendRows = (trend ?? []) as TrendPoint[];
  const maxTrend = Math.max(100, ...trendRows.map((t) => t.percentage));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Performance</h1>
        <p className="text-sm text-muted-foreground">
          Historical academic data stays attached to your account. Subscription
          status does not erase submitted scores. Changing year does not remove
          lifetime test history below.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall</CardTitle>
          <CardDescription>
            {PERFORMANCE_GRAIN_COPY.overall}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Bar
            label="Average test score"
            value={s?.average_percentage ?? 0}
            sub={`across ${s?.tests_taken ?? 0} attempted`}
          />
          <Bar label="Best score" value={s?.best_percentage ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject performance</CardTitle>
          <CardDescription>
            {PERFORMANCE_GRAIN_COPY.subject}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {subjectRows.map((sub) => (
            <div key={sub.subject_id} className="grid gap-2">
              <p className="text-sm font-medium">{sub.subject_name}</p>
              <Bar
                label="Tests"
                value={sub.test_average_percentage}
                sub={`(${sub.tests_taken})`}
              />
              <Bar
                label="Practice"
                value={sub.practice_accuracy}
                sub={`(${sub.practice_answered} answered)`}
              />
            </div>
          ))}
          {subjectRows.length === 0 && (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </CardContent>
      </Card>

      {weakRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weak chapters</CardTitle>
            <CardDescription>
              {PERFORMANCE_GRAIN_COPY.weakChapters}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {weakRows.map((w) => (
              <div
                key={w.chapter_id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {w.chapter_name}{" "}
                  <span className="text-muted-foreground">({w.subject_name})</span>
                </span>
                <Badge variant={w.accuracy < 50 ? "destructive" : "outline"}>
                  {w.accuracy}% ({w.answered})
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historical trend</CardTitle>
          <CardDescription>
            {PERFORMANCE_GRAIN_COPY.trend}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tests taken yet.</p>
          ) : (
            <div className="flex h-40 items-end gap-2 overflow-x-auto">
              {trendRows.map((t, i) => (
                <div
                  key={t.test_id}
                  className="flex min-w-10 flex-1 flex-col items-center gap-1"
                  title={`${t.title}: ${t.percentage}%`}
                >
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{ height: `${(t.percentage / maxTrend) * 100}%` }}
                  />
                  <span className="text-xs text-muted-foreground">
                    T{i + 1}
                  </span>
                  <span className="text-xs font-medium">{t.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
