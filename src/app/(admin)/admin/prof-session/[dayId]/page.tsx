import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { yearDisplayName } from "@/lib/library/types";
import {
  ProfSessionDayContentAdmin,
  type DayFolderRow,
  type DayOneLinerRow,
  type DayQuestionOption,
  type DayTestOption,
} from "./day-content-admin";

export const metadata = { title: "Prof. Session day — MedVerse Admin" };

export default async function AdminProfSessionDayPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { dayId } = await params;
  const { supabase } = await requireAdmin();

  const { data: day } = await supabase
    .from("prof_session_days")
    .select("id, name, status, sort_order, year_id, subject_id, subjects(name)")
    .eq("id", dayId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!day?.id || !day.subject_id || !day.year_id) {
    notFound();
  }

  const yearId = day.year_id as string;
  const subjectId = day.subject_id as string;
  const subjectName =
    (day.subjects as unknown as { name: string } | null)?.name ?? "Subject";

  const { data: yearRow } = await supabase
    .from("years")
    .select("id, year_number, name")
    .eq("id", yearId)
    .maybeSingle();

  const [
    { data: practiceIds },
    { data: questions },
    { data: tests },
    { data: oneLiners },
    { data: folders },
  ] = await Promise.all([
    supabase.rpc("list_day_practice_question_ids", { p_day_id: dayId }),
    supabase
      .from("questions")
      .select("id, difficulty, status, question_versions!questions_current_version_fk(stem)")
      .eq("subject_id", subjectId)
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("tests")
      .select("id, title, status, subject_id, prof_session_day_id")
      .eq("year_id", yearId)
      .or(`subject_id.eq.${subjectId},subject_id.is.null`)
      .order("title")
      .limit(200),
    supabase
      .from("one_liners")
      .select("id, title, status, prof_session_day_id")
      .eq("subject_id", subjectId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("title")
      .limit(200),
    supabase
      .from("material_folders")
      .select("id, name, day_slot_key, library_type, entitlement")
      .eq("prof_session_day_id", dayId)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const linkedPracticeIds = Array.isArray(practiceIds)
    ? (practiceIds as string[])
    : [];

  const questionOptions: DayQuestionOption[] = ((questions ?? []) as {
    id: string;
    difficulty: string;
    question_versions: { stem: string } | { stem: string }[] | null;
  }[]).map((q) => {
    const ver = Array.isArray(q.question_versions)
      ? q.question_versions[0]
      : q.question_versions;
    const stem = (ver?.stem ?? "").trim();
    return {
      id: q.id,
      difficulty: q.difficulty,
      stemPreview: stem.length > 120 ? `${stem.slice(0, 117)}…` : stem || "(no stem)",
    };
  });

  const testOptions: DayTestOption[] = ((tests ?? []) as {
    id: string;
    title: string;
    status: string;
    subject_id: string | null;
    prof_session_day_id: string | null;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    linkedToThisDay: t.prof_session_day_id === dayId,
    linkedElsewhere: Boolean(
      t.prof_session_day_id && t.prof_session_day_id !== dayId
    ),
  }));

  const oneLinerOptions: DayOneLinerRow[] = ((oneLiners ?? []) as {
    id: string;
    title: string;
    status: string;
    prof_session_day_id: string | null;
  }[]).map((ol) => ({
    id: ol.id,
    title: ol.title,
    status: ol.status === "published" ? "published" : "draft",
    linkedToThisDay: ol.prof_session_day_id === dayId,
  }));

  const folderRows: DayFolderRow[] = ((folders ?? []) as {
    id: string;
    name: string;
    day_slot_key: string | null;
    library_type: string;
    entitlement: string;
  }[]).map((f) => ({
    id: f.id,
    name: f.name,
    slotKey: (f.day_slot_key === "los" ? "los" : "guidelines") as
      | "guidelines"
      | "los",
    entitlement: f.entitlement,
  }));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/admin/prof-session?year=${yearId}&subject=${subjectId}`}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Prof. Session days
        </Link>
      </div>
      <ProfSessionDayContentAdmin
        dayId={dayId}
        dayName={day.name as string}
        dayStatus={day.status === "published" ? "published" : "draft"}
        yearId={yearId}
        yearLabel={yearRow ? yearDisplayName(yearRow) : "Class"}
        subjectId={subjectId}
        subjectName={subjectName}
        linkedPracticeIds={linkedPracticeIds}
        questions={questionOptions}
        tests={testOptions}
        oneLiners={oneLinerOptions}
        folders={folderRows}
      />
    </div>
  );
}
