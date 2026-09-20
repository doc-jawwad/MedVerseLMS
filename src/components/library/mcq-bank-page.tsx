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
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";
import { belongsOnFreeResources } from "@/lib/library/free-surface";
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

export async function McqBankPage({
  mode,
  subjectId,
  breadcrumbs,
  title,
  description,
  backHref,
}: {
  mode: "full" | "free" | "resources";
  subjectId?: string;
  breadcrumbs?: BreadcrumbCrumb[];
  title?: string;
  description?: string;
  backHref?: string;
}) {
  const { supabase, userId } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (mode === "full" && !studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="MCQ Bank"
        description="The full MCQ Bank unlocks with a live subscription. Admin-selected free practice stays under Resources."
      />
    );
  }

  const [{ data }, { data: subjectRows }, { data: grants }] = await Promise.all([
    supabase.rpc("practice_subjects"),
    mode === "free"
      ? supabase.from("subjects").select("id, entitlement")
      : Promise.resolve({ data: null }),
    mode === "free"
      ? supabase
          .from("access_grants")
          .select("subject_id")
          .eq("student_id", userId)
          .eq("grant_type", "practice_subject")
          .is("revoked_at", null)
      : Promise.resolve({ data: null }),
  ]);

  const entitlementById = new Map(
    ((subjectRows ?? []) as { id: string; entitlement: string }[]).map((s) => [
      s.id,
      s.entitlement,
    ])
  );
  const grantedSubjectIds = new Set(
    ((grants ?? []) as { subject_id: string }[]).map((g) => g.subject_id)
  );

  const subjects = ((data ?? []) as PracticeSubject[]).filter((s) => {
    if (subjectId && s.subject_id !== subjectId) return false;
    if (mode !== "free") return true;
    return (
      belongsOnFreeResources({
        entitlement: entitlementById.get(s.subject_id) ?? "any_subscription",
        hasPersonalGrant: grantedSubjectIds.has(s.subject_id),
        accessible: s.granted,
      }) && s.approved_questions > 0
    );
  });

  const pageTitle =
    title ?? (mode === "free" ? "Free MCQ Bank" : "MCQ Bank");
  const pageDescription =
    description ??
    (mode === "free"
      ? "Practice subjects your academy marked free (or granted to you). The full bank is a separate section."
      : "Learn with instant feedback — answers and explanations after every question.");

  return (
    <StudentPage>
      {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          backHref ? (
            <Link
              href={backHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back
            </Link>
          ) : undefined
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
                <CardTitle className="text-lg text-[var(--student-ink)]">
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
