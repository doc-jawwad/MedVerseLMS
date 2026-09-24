import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MaterialRow } from "@/lib/library/folder-tree";

export const metadata = { title: "Career Counseling Series — MedVerse LMS" };

export default async function CareerCounselingSeriesFolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const { supabase, enrollment } = await requireStudent();

  const { data: folder } = await supabase
    .from("material_folders")
    .select(
      "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
    )
    .eq("id", folderId)
    .eq("library_type", "career_counseling_series")
    .eq("year_id", enrollment.year_id)
    .is("deleted_at", null)
    .is("parent_id", null)
    .maybeSingle();

  if (!folder) notFound();

  const [{ data: materials }, { data: accessible }] = await Promise.all([
    supabase
      .from("materials")
      .select("id, folder_id, title, description, file_type, kind, status")
      .eq("folder_id", folder.id)
      .eq("kind", "pdf")
      .is("deleted_at", null)
      .order("sort_order")
      .order("title"),
    supabase.rpc("accessible_folder_ids"),
  ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const mats = ((materials ?? []) as MaterialRow[]).filter(
    (m) => m.status === "published"
  );
  const locked = !entitled.has(folder.id);

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Career Counseling Series"
        title={folder.name}
        description={folder.description ?? "Protected PDFs in this folder."}
        actions={
          <Link
            href="/career-counseling-series"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back
          </Link>
        }
      />

      {locked ? (
        <Card className="shadow-none">
          <CardContent className="pt-6">
            <ResourceLockNotice />
          </CardContent>
        </Card>
      ) : mats.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="When your academy uploads PDFs to this folder, they appear here."
        />
      ) : (
        <div className="grid gap-3">
          {mats.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl border p-3 text-sm transition-colors hover:bg-accent/50"
            >
              <div>
                <MaterialOpenLink
                  materialId={m.id}
                  kind="pdf"
                  title={m.title}
                />
                {m.description ? (
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                ) : null}
              </div>
              <Badge variant="secondary" className="uppercase">
                pdf
              </Badge>
            </div>
          ))}
        </div>
      )}
    </StudentPage>
  );
}
