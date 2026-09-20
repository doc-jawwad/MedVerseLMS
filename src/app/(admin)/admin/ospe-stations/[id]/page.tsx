import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { OspeStationEditor } from "../ospe-station-editor";
import { EntitlementSelect } from "@/components/admin/entitlement-select";

export const metadata = { title: "Edit OSPE Station — MedVerse Admin" };

export default async function EditOspeStationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ospe_station_for_admin", {
    p_station_id: id,
  });
  if (error || !data) notFound();
  const station = data as {
    id: string;
    title: string;
    answer: string;
    year_id: string;
    subject_id: string;
    status: "draft" | "published";
    entitlement: string;
    sort_order: number;
  };

  const [{ data: years }, { data: subjects }] = await Promise.all([
    supabase.from("years").select("id, year_number, name").order("year_number"),
    supabase.from("subjects").select("id, name, year_id").order("name"),
  ]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Edit OSPE station
        </h1>
        <EntitlementSelect
          kind="ospe_station"
          id={station.id}
          value={station.entitlement}
        />
      </div>
      <OspeStationEditor
        years={years ?? []}
        subjects={subjects ?? []}
        stationId={station.id}
        previewImageSrc={`/api/ospe-stations/${station.id}`}
        initial={{
          title: station.title,
          answer: station.answer,
          year_id: station.year_id,
          subject_id: station.subject_id,
          status: station.status,
          sort_order: station.sort_order ?? 0,
        }}
      />
    </div>
  );
}
