import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/require-user";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import type { FolderRow, MaterialRow } from "@/lib/library/folder-tree";

export const metadata = { title: "Past Papers — MedVerse LMS" };

export default async function PastPapersFolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
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

  const { data: folder } = await supabase
    .from("material_folders")
    .select(
      "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
    )
    .eq("id", folderId)
    .eq("library_type", "past_papers")
    .eq("year_id", enrollment.year_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!folder) notFound();

  const [
    { data: childFolders },
    { data: materials },
    { data: accessible },
  ] = await Promise.all([
    supabase
      .from("material_folders")
      .select(
        "id, name, description, year_id, subject_id, parent_id, sort_order, entitlement, library_type"
      )
      .eq("library_type", "past_papers")
      .eq("parent_id", folder.id)
      .eq("year_id", enrollment.year_id)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name"),
    supabase
      .from("materials")
      .select("id, folder_id, title, description, file_type, kind, status")
      .is("deleted_at", null)
      .order("sort_order")
      .order("title"),
    supabase.rpc("accessible_folder_ids"),
  ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const children = (childFolders ?? []) as FolderRow[];
  const mats = ((materials ?? []) as MaterialRow[]).filter(
    (m) => m.status === "published" && m.kind === "pdf"
  );
  const folderMats = mats.filter((m) => m.folder_id === folder.id);
  const locked = !entitled.has(folder.id);
  const isEmpty = !locked && children.length === 0 && folderMats.length === 0;

  return (
    <StudentPage>
      <PageHeader
        eyebrow="Past Papers"
        title={folder.name}
        description={
          folder.description ??
          "Sub-categories and PDF papers in this section."
        }
        actions={
          <Link
            href="/past-papers"
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
      ) : (
        <>
          {children.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {children.map((child) => {
                const childLocked = !entitled.has(child.id);
                const childPdfs = mats.filter((m) => m.folder_id === child.id);
                return (
                  <Card
                    key={child.id}
                    className={`shadow-none ${childLocked ? "opacity-95" : ""}`}
                  >
                    <CardHeader>
                      <CardTitle className="text-base text-[var(--student-ink)]">
                        {child.name}
                      </CardTitle>
                      {child.description ? (
                        <CardDescription>{child.description}</CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      {childLocked ? (
                        <ResourceLockNotice />
                      ) : childPdfs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No papers in this sub-category yet.
                        </p>
                      ) : (
                        childPdfs.map((m) => (
                          <PdfRow key={m.id} material={m} />
                        ))
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {folderMats.length > 0 && (
            <div className="grid gap-3">
              <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
                Papers
              </h2>
              {folderMats.map((m) => (
                <PdfRow key={m.id} material={m} />
              ))}
            </div>
          )}

          {isEmpty && (
            <EmptyState
              title="Nothing here yet"
              description="When your academy uploads papers to this category, they appear here."
            />
          )}
        </>
      )}
    </StudentPage>
  );
}

function PdfRow({ material }: { material: MaterialRow }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-3 text-sm transition-colors hover:bg-accent/50">
      <div>
        <MaterialOpenLink
          materialId={material.id}
          kind={material.kind ?? "pdf"}
          title={material.title}
        />
        {material.description ? (
          <p className="text-xs text-muted-foreground">{material.description}</p>
        ) : null}
      </div>
      <Badge variant="secondary" className="uppercase">
        {material.kind ?? material.file_type ?? "pdf"}
      </Badge>
    </div>
  );
}
