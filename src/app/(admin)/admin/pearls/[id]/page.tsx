import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { PearlEditor } from "../pearl-editor";
import { EntitlementSelect } from "@/components/admin/entitlement-select";

export const metadata = { title: "Edit Pearl Point — MedVerse Admin" };

export default async function EditPearlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pearl_for_admin", {
    p_pearl_id: id,
  });
  if (error || !data) notFound();
  const pearl = data as {
    id: string;
    prompt: string;
    answer: string;
    explanation: string;
    year_id: string;
    subject_id: string;
    chapter_id: string | null;
    topic_id: string | null;
    status: "draft" | "published";
    entitlement: string;
  };

  const [{ data: years }, { data: subjects }, { data: chapters }, { data: topics }] = await Promise.all([
    supabase.from("years").select("id, year_number, name").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
    supabase.from("chapters").select("id, name, subject_id").order("sort_order").order("name"),
    supabase.from("topics").select("id, name, chapter_id").order("sort_order").order("name"),
  ]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">Edit Pearl Point</h1>
        <EntitlementSelect kind="pearl_point" id={pearl.id} value={pearl.entitlement} />
      </div>
      <PearlEditor
        years={years ?? []}
        subjects={subjects ?? []}
        chapters={chapters ?? []}
        topics={topics ?? []}
        pearlId={pearl.id}
        initial={{
          prompt: pearl.prompt,
          answer: pearl.answer,
          explanation: pearl.explanation ?? "",
          year_id: pearl.year_id,
          subject_id: pearl.subject_id,
          chapter_id: pearl.chapter_id,
          topic_id: pearl.topic_id,
          status: pearl.status,
        }}
      />
    </div>
  );
}
