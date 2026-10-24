import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { Badge } from "@/components/ui/badge";
import { OneLinerEditor } from "../one-liner-editor";

export const metadata = { title: "Edit One-liner — MedVerse Admin" };

export default async function EditOneLinerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { id } = await params;

  const { data: item } = await supabase
    .from("one_liners")
    .select(
      "id, title, body, status, year_id, subject_id, has_source_pdf, subjects(name)"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!item) notFound();

  const { data: adminMeta } = await supabase.rpc("get_one_liner_for_admin", {
    p_one_liner_id: id,
  });
  const meta = (adminMeta ?? {}) as {
    has_source_pdf?: boolean;
    r2_byte_size?: number | null;
  };

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("year_id", item.year_id)
    .order("name");

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/one-liners" className="text-sm text-muted-foreground hover:underline">
          ← One-liners
        </Link>
        <Badge variant={item.status === "published" ? "default" : "secondary"}>
          {item.status}
        </Badge>
      </div>

      <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
        {item.title}
      </h1>
      <p className="text-sm text-muted-foreground">
        {(item.subjects as unknown as { name: string } | null)?.name ?? "—"}
      </p>

      <OneLinerEditor
        yearId={item.year_id}
        subjects={subjects ?? []}
        linerId={item.id}
        hasSourcePdf={Boolean(
          meta.has_source_pdf ??
            (item as { has_source_pdf?: boolean }).has_source_pdf
        )}
        sourcePdfBytes={meta.r2_byte_size ?? null}
        initial={{
          title: item.title,
          body: item.body,
          subject_id: item.subject_id,
          status: item.status as "draft" | "published",
        }}
      />
    </div>
  );
}
