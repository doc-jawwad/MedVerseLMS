import { requireStudent } from "@/lib/auth/require-user";
import { PearlPracticeSession } from "@/components/practice/pearl-practice-session";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { SectionLock } from "@/components/subscription/section-lock";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";
import { belongsOnFreeResources } from "@/lib/library/free-surface";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import Link from "next/link";

export async function PearlPointsLibraryPage({
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
        title="Pearl Points"
        description="The full Pearl Points library unlocks with a live subscription. Free recall points stay under Resources."
      />
    );
  }

  const [{ data: pearls }, { data: accessible }, { data: subjects }] =
    await Promise.all([
      supabase
        .from("pearl_points")
        .select(
          "id, prompt, year_id, subject_id, chapter_id, topic_id, entitlement, subjects(name)"
        )
        .eq("status", "published")
        .order("sort_order")
        .order("created_at", { ascending: false }),
      supabase.rpc("accessible_pearl_ids"),
      supabase.from("subjects").select("id, name").order("name"),
    ]);

  const allowed = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const items = (pearls ?? [])
    .map((p) => ({
      id: p.id,
      prompt: p.prompt,
      year_id: p.year_id,
      subject_id: p.subject_id,
      chapter_id: p.chapter_id,
      topic_id: p.topic_id,
      entitlement: p.entitlement as string,
      accessible: allowed.has(p.id),
      subject_name:
        (p.subjects as unknown as { name: string } | null)?.name ?? null,
    }))
    .filter((p) => {
      if (subjectId && p.subject_id !== subjectId) return false;
      if (mode === "free") {
        return belongsOnFreeResources({
          entitlement: p.entitlement,
          accessible: p.accessible,
        });
      }
      return true;
    });

  const filterSubjects =
    mode === "free"
      ? (subjects ?? []).filter((s) =>
          items.some((p) => p.subject_id === s.id)
        )
      : subjectId
        ? (subjects ?? []).filter((s) => s.id === subjectId)
        : (subjects ?? []);

  const pageTitle =
    title ?? (mode === "free" ? "Free Pearl Points" : "Pearl Points");
  const pageDescription =
    description ??
    (mode === "free"
      ? "Admin-selected free recall points for your class. The full set is a separate section."
      : "High-yield one-liners for rapid recall. Reveal the answer when you are ready — this is not an exam.");
  const defaultBack =
    mode === "free" ? "/free-resources/pearl-points" : "/pearl-points";

  return (
    <StudentPage width="narrow">
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
      {items.length === 0 ? (
        <EmptyState
          title={
            mode === "free"
              ? "No free pearl points yet"
              : "No pearl points for your year yet"
          }
          description="When your academy publishes recall points you can use, they appear here."
        />
      ) : (
        <PearlPracticeSession
          items={items}
          subjects={filterSubjects}
          studentId={userId}
          backHref={backHref ?? defaultBack}
        />
      )}
    </StudentPage>
  );
}
