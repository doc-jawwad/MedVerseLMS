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

export const metadata = { title: "Practice MCQs — MedVerse LMS" };

type PracticeSubject = {
  subject_id: string;
  subject_name: string;
  approved_questions: number;
  granted: boolean;
  answered: number;
  correct: number;
};

export default async function PracticePage() {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Practice MCQs"
        description="The full practice catalog unlocks with a live subscription. Free practice subjects stay under Free Resources."
      />
    );
  }

  const { data } = await supabase.rpc("practice_subjects");
  const subjects = (data ?? []) as PracticeSubject[];

  return (
    <StudentPage>
      <PageHeader
        title="Practice MCQs"
        description="Learn with instant feedback — answers and explanations after every question."
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
                <CardTitle className="flex items-center justify-between text-lg text-[#072855]">
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
              title="No subjects found for your year yet"
              description="Practice banks appear here once your academy publishes approved questions."
            />
          </div>
        )}
      </div>
    </StudentPage>
  );
}
