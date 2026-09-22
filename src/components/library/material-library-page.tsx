import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { SectionLock } from "@/components/subscription/section-lock";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";
import { belongsOnFreeResources } from "@/lib/library/free-surface";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import {
  LIBRARY_META,
  folderLibraryLabel,
  type FolderLibraryType,
  type StudentLibraryType,
} from "@/lib/library/types";

type Folder = {
  id: string;
  name: string;
  subject_id: string | null;
  library_type: string;
  entitlement: string;
};

type Material = {
  id: string;
  folder_id: string;
  title: string;
  description: string;
  file_type: string;
  kind: string;
};

export async function MaterialLibraryPage({
  libraryType,
  mode,
  subjectId,
  contentSurface,
  profSessionDayId,
  daySlotKey,
  breadcrumbs,
  title,
  description,
  backHref,
}: {
  libraryType: FolderLibraryType;
  mode: "full" | "free" | "resources";
  subjectId?: string;
  /** academic (default) or prof_session Block chrome. */
  contentSurface?: "academic" | "prof_session";
  /** When set, only day-scoped Guidelines/LoS folders. */
  profSessionDayId?: string;
  daySlotKey?: "guidelines" | "los";
  breadcrumbs?: BreadcrumbCrumb[];
  title?: string;
  description?: string;
  backHref?: string;
}) {
  const { supabase, userId } = await requireStudent();
  const folderMeta = folderLibraryLabel(libraryType);
  const meta =
    libraryType in LIBRARY_META
      ? LIBRARY_META[libraryType as StudentLibraryType]
      : { label: folderMeta.label, description: folderMeta.description };
  const hasLiveAccess = await getStudentHasLiveSubscription();

  if (mode === "full" && !studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title={meta.label}
        description={`The full ${meta.label} library unlocks with a live subscription. Free items your academy published stay under Resources.`}
      />
    );
  }

  let foldersQuery = supabase
    .from("material_folders")
    .select("id, name, subject_id, library_type, entitlement")
    .eq("library_type", libraryType)
    .is("deleted_at", null)
    .order("sort_order")
    .order("name");

  if (contentSurface) {
    foldersQuery = foldersQuery.eq("content_surface", contentSurface);
  } else {
    foldersQuery = foldersQuery.or(
      "content_surface.eq.academic,content_surface.is.null"
    );
  }

  if (profSessionDayId) {
    foldersQuery = foldersQuery.eq("prof_session_day_id", profSessionDayId);
    if (daySlotKey) {
      foldersQuery = foldersQuery.eq("day_slot_key", daySlotKey);
    }
  } else if (contentSurface === "prof_session") {
    foldersQuery = foldersQuery.is("prof_session_day_id", null);
  }

  const [
    { data: folders },
    { data: materials },
    { data: subjects },
    { data: accessible },
    { data: grants },
  ] = await Promise.all([
    foldersQuery,
    supabase
      .from("materials")
      .select("id, folder_id, title, description, file_type, kind")
      .is("deleted_at", null)
      .order("sort_order")
      .order("title"),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.rpc("accessible_folder_ids"),
    mode === "free"
      ? supabase
          .from("access_grants")
          .select("folder_id")
          .eq("student_id", userId)
          .eq("grant_type", "materials_folder")
          .is("revoked_at", null)
      : Promise.resolve({ data: null }),
  ]);

  const entitled = new Set(
    (accessible ?? []).map((row: { id: string }) => row.id)
  );
  const grantedFolders = new Set(
    ((grants ?? []) as { folder_id: string }[]).map((g) => g.folder_id)
  );
  const subjectName = (id: string | null) =>
    subjects?.find((s) => s.id === id)?.name ?? "General";

  let visibleFolders = (folders ?? []) as Folder[];
  if (subjectId) {
    visibleFolders = visibleFolders.filter((f) => f.subject_id === subjectId);
  }
  if (mode === "free") {
    visibleFolders = visibleFolders.filter((f) =>
      belongsOnFreeResources({
        entitlement: f.entitlement,
        hasPersonalGrant: grantedFolders.has(f.id),
        accessible: entitled.has(f.id),
      })
    );
  }

  const mats = (materials ?? []) as Material[];
  const foldersWithItems = visibleFolders.filter((f) => {
    if (mode === "full" || mode === "resources") return true;
    return mats.some((m) => m.folder_id === f.id);
  });

  const grouped = new Map<string, Folder[]>();
  for (const f of foldersWithItems) {
    const key = f.subject_id ?? "general";
    const list = grouped.get(key) ?? [];
    list.push(f);
    grouped.set(key, list);
  }

  const showLocks = mode === "full" || mode === "resources";
  const pageTitle =
    title ?? (mode === "free" ? `Free ${meta.label}` : meta.label);
  const pageDescription =
    description ??
    (mode === "free"
      ? `Admin-selected free ${meta.label.toLowerCase()} for your class. The full library is a separate section.`
      : meta.description);

  return (
    <StudentPage>
      {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          backHref ? (
            <Link
              href={backHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Back
            </Link>
          ) : undefined
        }
      />

      {[...grouped.entries()].map(([sid, subjectFolders]) => (
        <div key={sid} className="grid gap-3">
          <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
            {subjectName(sid === "general" ? null : sid)}
          </h2>
          {subjectFolders.map((f) => {
            const items = mats.filter((m) => m.folder_id === f.id);
            const locked = showLocks && !entitled.has(f.id);
            return (
              <Card
                key={f.id}
                className={`shadow-none ${locked ? "opacity-95" : ""}`}
              >
                <CardHeader>
                  <CardTitle className="text-base text-[var(--student-ink)]">
                    {f.name}
                  </CardTitle>
                  {!locked && items.length === 0 && (
                    <CardDescription>Nothing here yet.</CardDescription>
                  )}
                </CardHeader>
                {(locked || items.length > 0) && (
                  <CardContent className="grid gap-3">
                    {locked && <ResourceLockNotice />}
                    {!locked &&
                      items.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-xl border p-3 text-sm transition-colors hover:bg-accent/50"
                        >
                          <div>
                            <MaterialOpenLink
                              materialId={m.id}
                              kind={m.kind ?? "drive"}
                              title={m.title}
                            />
                            {m.description && (
                              <p className="text-xs text-muted-foreground">
                                {m.description}
                              </p>
                            )}
                          </div>
                          <Badge variant="secondary" className="uppercase">
                            {m.kind && m.kind !== "drive" ? m.kind : m.file_type}
                          </Badge>
                        </div>
                      ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ))}

      {foldersWithItems.length === 0 && (
        <EmptyState
          title={
            mode === "free"
              ? `No free ${meta.label.toLowerCase()} yet`
              : `No ${meta.label.toLowerCase()} for your year yet`
          }
          description={
            mode === "free"
              ? "When your academy publishes free items in this category, they appear here."
              : "When your academy publishes this library, folders appear here grouped by subject."
          }
        />
      )}
    </StudentPage>
  );
}
