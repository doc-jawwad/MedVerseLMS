import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

type PracticeSubject = {
  subject_id: string;
  subject_name: string;
  approved_questions: number;
  granted: boolean;
  answered: number;
  correct: number;
};

export async function McqBankPage({ mode }: { mode: "full" | "free" }) {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (mode === "full" && !studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="MCQ Bank"
        description="The full MCQ Bank unlocks with a live subscription. Admin-selected free practice stays under Free Resources."
      />
    );
  }

  const { data } = await supabase.rpc("practice_subjects");
  const subjects = ((data ?? []) as PracticeSubject[]).filter((s) =>
    mode === "free" ? s.granted : true
  );

  return (
    <StudentPage>
      <PageHeader
        title={mode === "free" ? "Free MCQ Bank" : "MCQ Bank"}
        description={
          mode === "free"
            ? "Practice subjects your academy marked free (or granted to you). The full bank is a separate section."
            : "Learn with instant feedback — answers and explanations after every question."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subjects.map((s) => {
          const acc =
            s.answered > 0 ? Math.round((100 * s.correct) / s.answered) : null;
          const card = (
            <Card
              className={
                s.granted
                  ? "h-full shadow-none transition-colors hover:bg-accent/40"
                  : "h-full shadow-none opacity-90"
              }
            >
              <CardHeader>
                <CardTitle className="text-lg text-[#072855]">
                  {s.subject_name}
                </CardTitle>
                <CardDescription>
                  {s.approved_questions} questions available
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-muted-foreground">
                {s.granted ? (
                  s.answered > 0 ? (
                    `${s.answered} answered · ${acc}% correct`
                  ) : (
                    "Not started yet"
                  )
                ) : (
                  <ResourceLockNotice />
                )}
              </CardContent>
            </Card>
          );
          return s.granted ? (
            <Link key={s.subject_id} href={`/practice/${s.subject_id}`}>
              {card}
            </Link>
          ) : (
            <div key={s.subject_id}>{card}</div>
          );
        })}
        {subjects.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState
              title={
                mode === "free"
                  ? "No free MCQ subjects yet"
                  : "No subjects found for your year yet"
              }
              description={
                mode === "free"
                  ? "When your academy publishes free practice for your class, it appears here."
                  : "Practice banks appear here once your academy publishes approved questions."
              }
            />
          </div>
        )}
      </div>
    </StudentPage>
  );
}
