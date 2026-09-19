import { requireStudent } from "@/lib/auth/require-user";
import { PearlPlayer } from "@/components/study/pearl-player";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { SectionLock } from "@/components/subscription/section-lock";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

export async function PearlPointsLibraryPage({
  mode,
}: {
  mode: "full" | "free";
}) {
  const { supabase } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (mode === "full" && !studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Pearl Points"
        description="The full Pearl Points library unlocks with a live subscription. Free recall points stay under Free Resources."
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
      accessible: allowed.has(p.id),
      subject_name:
        (p.subjects as unknown as { name: string } | null)?.name ?? null,
    }))
    .filter((p) => (mode === "free" ? p.accessible : true));

  const filterSubjects =
    mode === "free"
      ? (subjects ?? []).filter((s) =>
          items.some((p) => p.subject_id === s.id)
        )
      : (subjects ?? []);

  return (
    <StudentPage width="narrow">
      <PageHeader
        title={mode === "free" ? "Free Pearl Points" : "Pearl Points"}
        description={
          mode === "free"
            ? "Admin-selected free recall points for your class. The full set is a separate section."
            : "High-yield one-liners for rapid recall. Reveal the answer when you are ready — this is not an exam."
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
        <PearlPlayer items={items} subjects={filterSubjects} />
      )}
    </StudentPage>
  );
}
