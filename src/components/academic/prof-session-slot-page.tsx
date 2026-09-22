import Link from "next/link";
import { McqBankPage } from "@/components/library/mcq-bank-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import {
  PROF_SESSION_LABEL,
  PROF_SESSION_MCQ_BANK_SLUG,
  buildAcademicBreadcrumbs,
  dayHref,
  type AcademicProfSessionSubject,
  type AcademicTree,
  type AcademicTreeFolder,
  type TestDaySlotId,
} from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";

/** Only rendered for subscribed students (page gate shows SectionLock for free). */
export async function ProfSessionSlotPage({
  tree,
  subject,
  day,
  slotId,
  slot,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
  day: AcademicTreeFolder;
  slotId: TestDaySlotId;
  slot: AcademicTreeFolder;
}) {
  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: "MCQ Bank",
    categorySlug: PROF_SESSION_MCQ_BANK_SLUG,
    dayName: day.name,
    daySlug: day.slug,
    slotName: slot.name,
    slotSlug: slot.slug,
  });
  const backHref = dayHref(subject.product_key, day.slug);
  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;

  if (slotId === "guidelines" || slotId === "los") {
    return (
      <MaterialLibraryPage
        libraryType={slotId === "los" ? "los" : "guidelines"}
        mode="full"
        subjectId={subjectId}
        contentSurface="prof_session"
        profSessionDayId={day.id}
        daySlotKey={slotId}
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description={
          slotId === "los"
            ? "Learning outcomes for this Prof. Session day."
            : "Guidelines for this Prof. Session day."
        }
        backHref={backHref}
      />
    );
  }

  if (slotId === "one_liners") {
    return (
      <ProfSessionOneLinersSlot
        dayId={day.id}
        title={`${day.name} · ${slot.name}`}
        breadcrumbs={breadcrumbs}
        backHref={backHref}
      />
    );
  }

  if (slotId === "practice_mcqs") {
    return (
      <McqBankPage
        mode="full"
        subjectId={subjectId}
        profSessionDayId={day.id}
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description="Practice MCQs curated for this Prof. Session day."
        backHref={backHref}
      />
    );
  }

  if (slotId === "test_mcq") {
    return (
      <StudentPage>
        <AcademicBreadcrumbs crumbs={breadcrumbs} />
        <PageHeader
          title={`${day.name} · Test MCQs`}
          description={`${PROF_SESSION_LABEL} formal Test MCQs use the standard exam engine when linked to this day.`}
          actions={
            <Link
              href={backHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to day
            </Link>
          }
        />
        <p className="text-sm text-muted-foreground">
          Formal timed exams stay on the Tests surface so attempt state, device
          binding, and scoring remain unchanged.
        </p>
        <Link
          href="/tests"
          className="mt-4 inline-flex text-sm font-medium text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
        >
          Go to Tests
        </Link>
      </StudentPage>
    );
  }

  return null;
}

async function ProfSessionOneLinersSlot({
  dayId,
  title,
  breadcrumbs,
  backHref,
}: {
  dayId: string;
  title: string;
  breadcrumbs: ReturnType<typeof buildAcademicBreadcrumbs>;
  backHref: string;
}) {
  const { supabase } = await requireStudent();
  const { data } = await supabase
    .from("one_liners")
    .select("id, title, body")
    .eq("prof_session_day_id", dayId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("sort_order")
    .order("title");

  const rows = (data ?? []) as { id: string; title: string; body: string }[];

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={breadcrumbs} />
      <PageHeader
        title={title}
        description="Day-scoped one-liners (not Pearl Points)."
        actions={
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to day
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No one-liners for this day"
          description="Published one-liners linked to this day will appear here."
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-border/80 bg-card px-4 py-3"
            >
              <p className="font-medium text-[var(--student-ink)]">{row.title}</p>
              {row.body ? (
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                  {row.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </StudentPage>
  );
}
