import { requireStudent } from "@/lib/auth/require-user";
import { OspePracticeSession } from "@/components/practice/ospe-practice-session";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";

/**
 * Student OSPE Practice catalog + session.
 * Metadata SELECT only — never answer / R2 columns.
 */
export async function OspePracticeLibraryPage() {
  const { supabase, userId } = await requireStudent();

  const [{ data: stations }, { data: accessible }, { data: subjects }] =
    await Promise.all([
      supabase
        .from("ospe_stations")
        .select(
          "id, title, year_id, subject_id, status, entitlement, required_plan_id, sort_order, created_at, updated_at, subjects(name)"
        )
        .eq("status", "published")
        .order("sort_order")
        .order("created_at", { ascending: true }),
      supabase.rpc("accessible_ospe_station_ids"),
      supabase.from("subjects").select("id, name").order("name"),
    ]);

  const allowed = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );

  const items = (stations ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    year_id: s.year_id,
    subject_id: s.subject_id,
    sort_order: s.sort_order ?? 0,
    accessible: allowed.has(s.id),
    subject_name:
      (s.subjects as unknown as { name: string } | null)?.name ?? null,
  }));

  const filterSubjects = (subjects ?? []).filter((subj) =>
    items.some((s) => s.subject_id === subj.id)
  );

  return (
    <StudentPage width="narrow">
      <PageHeader
        title="OSPE Practice"
        description="Station images with a reveal answer. Reach this from any Block → OSPE → OSPE Practice. Practice only — not a formal exam and not library OSPE packs."
      />
      {items.length === 0 ? (
        <EmptyState
          title="No OSPE stations for your class yet"
          description="When your academy publishes OSPE practice stations, they appear here."
        />
      ) : (
        <OspePracticeSession
          items={items}
          subjects={filterSubjects}
          studentId={userId}
          backHref="/practice/ospe"
        />
      )}
    </StudentPage>
  );
}
