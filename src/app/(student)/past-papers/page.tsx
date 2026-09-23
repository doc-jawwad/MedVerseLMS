import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { SectionLock } from "@/components/subscription/section-lock";
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
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import { nestFolders } from "@/lib/library/folder-tree";
import type { FolderRow, MaterialRow } from "@/lib/library/folder-tree";

export const metadata = { title: "Past Papers — MedVerse LMS" };

export default async function PastPapersPage() {
  const { supabase, enrollment } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Past Papers"
        description="Past Papers unlock with a live subscription. Free items your academy publishes stay under Resources."
      />
    );
  }

  const [{ data: folders }, { data: materials }, { data: accessible }] =
    await Promise.all([
      supabase
        .from("material_folders")
        .select(
          "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
        )
        .eq("library_type", "past_papers")
        .eq("year_id", enrollment.year_id)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      supabase
        .from("materials")
        .select(
          "id, folder_id, title, description, file_type, kind, status"
        )
        .is("deleted_at", null)
        .order("sort_order")
        .order("title"),
      supabase.rpc("accessible_folder_ids"),
    ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const tree = nestFolders(
    (folders ?? []) as FolderRow[],
    (materials ?? []) as MaterialRow[],
    "past_papers"
  );

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Study"
        title="Past Papers"
        description="Exam past papers for your class, organized by category."
      />

      {tree.length === 0 ? (
        <EmptyState
          title="No past papers yet"
          description="When your academy publishes past paper categories, they appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tree.map((folder) => {
            const locked = !entitled.has(folder.id);
            const childCount = folder.children.length;
            const pdfCount =
              folder.materials.length +
              folder.children.reduce((n, c) => n + c.materials.length, 0);
            return (
              <Link key={folder.id} href={`/past-papers/${folder.id}`}>
                <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="text-lg text-[var(--student-ink)]">
                      {folder.name}
                    </CardTitle>
                    <CardDescription>
                      {locked
                        ? "Subscription access required for this category."
                        : [
                            childCount > 0
                              ? `${childCount} sub-categor${childCount === 1 ? "y" : "ies"}`
                              : null,
                            pdfCount > 0
                              ? `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`
                              : "Browse papers",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
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
