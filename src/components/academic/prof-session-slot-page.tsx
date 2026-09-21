import Link from "next/link";
import { McqBankPage } from "@/components/library/mcq-bank-page";
import { PearlPointsLibraryPage } from "@/components/library/pearl-points-library-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import {
  PROF_SESSION_LABEL,
  buildAcademicBreadcrumbs,
  dayHref,
  type AcademicTree,
  type AcademicTreeFolder,
  type TestDaySlotId,
} from "@/lib/academic-tree";

/** Only rendered for subscribed students (page gate shows SectionLock for free). */
export async function ProfSessionSlotPage({
  tree,
  day,
  slotId,
  slot,
}: {
  tree: AcademicTree;
  day: AcademicTreeFolder;
  slotId: TestDaySlotId;
  slot: AcademicTreeFolder;
}) {
  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    dayName: day.name,
    daySlug: day.slug,
    slotName: slot.name,
    slotSlug: slot.slug,
  });
  const backHref = dayHref(day.slug);

  if (slotId === "syllabus" || slotId === "guidelines") {
    return (
      <MaterialLibraryPage
        libraryType="guidelines"
        mode="full"
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description={
          slotId === "syllabus"
            ? "Syllabus materials for this Prof. Session day."
            : "Guidelines for this Prof. Session day."
        }
        backHref={backHref}
      />
    );
  }

  if (slotId === "one_liners") {
    return (
      <PearlPointsLibraryPage
        mode="full"
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description="One-liners and pearl points for this Prof. Session day."
        backHref={backHref}
      />
    );
  }

  if (slotId === "practice_mcqs") {
    return (
      <McqBankPage
        mode="full"
        breadcrumbs={breadcrumbs}
        title={`${day.name} · ${slot.name}`}
        description="Practice MCQs for this Prof. Session day."
        backHref={backHref}
      />
    );
  }

  if (slotId === "test_mcq") {
    return (
      <StudentPage>
        <AcademicBreadcrumbs crumbs={breadcrumbs} />
        <PageHeader
          title={`${day.name} · Test MCQ`}
          description={`${PROF_SESSION_LABEL} formal Test MCQ uses the standard exam engine. Open Tests to start or continue an eligible attempt.`}
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
