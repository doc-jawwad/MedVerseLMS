import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FolderRow, MaterialRow } from "@/lib/library/folder-tree";

export const metadata = { title: "Career Counseling Series — MedVerse LMS" };

export default async function CareerCounselingSeriesPage() {
  // Enrollment is required for LMS access, but CCS is not filtered by class year.
  const { supabase } = await requireStudent();

  const [{ data: folders }, { data: materials }, { data: accessible }] =
    await Promise.all([
      supabase
        .from("material_folders")
        .select(
          "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
        )
        .eq("library_type", "career_counseling_series")
        .is("deleted_at", null)
        .is("parent_id", null)
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select(
          "id, folder_id, title, description, file_type, kind, status"
        )
        .eq("kind", "pdf")
        .is("deleted_at", null)
        .order("sort_order")
        .order("title"),
      supabase.rpc("accessible_folder_ids"),
    ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const list = (folders ?? []) as FolderRow[];
  const folderIds = new Set(list.map((f) => f.id));
  const mats = ((materials ?? []) as MaterialRow[]).filter(
    (m) => m.status === "published" && folderIds.has(m.folder_id)
  );

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Study"
        title="Career Counseling Series"
        description="Career guidance for every class. Open without a paid subscription; each folder still respects its own access setting."
      />

      {list.length === 0 ? (
        <EmptyState
          title="No folders yet"
          description="When your academy publishes Career Counseling Series folders, they appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((folder) => {
            const locked = !entitled.has(folder.id);
            const pdfCount = mats.filter((m) => m.folder_id === folder.id).length;
            return (
              <Link
                key={folder.id}
                href={`/career-counseling-series/${folder.id}`}
                data-testid={`career-counseling-folder-${folder.id}`}
              >
                <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="text-lg text-[var(--student-ink)]">
                      {folder.name}
                    </CardTitle>
                    <CardDescription>
                      {folder.description
                        ? folder.description
                        : locked
                          ? "Access required for this folder."
                          : pdfCount > 0
                            ? `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`
                            : "Browse materials"}
                    </CardDescription>
                    {locked ? (
                      <div className="pt-2">
                        <ResourceLockNotice compact />
                      </div>
                    ) : null}
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </StudentPage>
  );
}
