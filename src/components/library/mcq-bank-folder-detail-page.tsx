import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";
import { subfolderHref } from "@/lib/academic-tree";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import {
  normalizeFolderPracticeProgress,
  normalizeSubfolderPracticeProgress,
} from "@/lib/practice/mcq-bank-folder-progress";

type MaterialRow = {
  id: string;
  title: string;
  description: string;
  kind: string;
};

type SubfolderProgressRow = {
  subfolder_id: string;
  name: string;
  sort_order: number | string;
  total: number | string;
  done: number | string;
  remaining: number | string;
  percent_complete: number | string;
  complete: boolean;
};

/**
 * Student MCQ Bank folder hub — PDFs + subfolder list with progress.
 * Practice starts from a subfolder, not the folder aggregate.
 */
export async function McqBankFolderDetailPage({
  subjectId,
  folderId,
  breadcrumbs,
  backHref,
  blockSlug,
}: {
  subjectId: string;
  folderId: string;
  breadcrumbs?: BreadcrumbCrumb[];
  backHref: string;
  blockSlug: string;
}) {
  const { supabase } = await requireStudent();

  const [{ data: granted }, { data: folder }] = await Promise.all([
    supabase.rpc("has_practice_access", { p_subject_id: subjectId }),
    supabase
      .from("mcq_bank_folders")
      .select("id, name, material_folder_id, academic_product_subject_id")
      .eq("id", folderId)
      .eq("academic_product_subject_id", subjectId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (!folder) {
    return (
      <StudentPage>
        {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
        <EmptyState
          title="Folder not found"
          description="This MCQ Bank folder is unavailable."
        />
      </StudentPage>
    );
  }

  const accessible = granted === true;

  let materials: MaterialRow[] = [];
  if (folder.material_folder_id) {
    const { data } = await supabase
      .from("materials")
      .select("id, title, description, kind")
      .eq("folder_id", folder.material_folder_id)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("sort_order")
      .order("title");
    materials = (data ?? []) as MaterialRow[];
  }

  let folderProgress = normalizeFolderPracticeProgress(
    {
      total: 0,
      done: 0,
      remaining: 0,
      percent_complete: 0,
      complete: false,
      favorites: 0,
      incorrect: 0,
    },
    folder.id
  );

  let subfolders: Array<{
    id: string;
    name: string;
    sort_order: number;
    done: number;
    total: number;
  }> = [];

  if (accessible) {
    const [{ data: prog }, { data: subProg }] = await Promise.all([
      supabase.rpc("get_mcq_bank_folder_practice_progress", {
        p_folder_id: folder.id,
      }),
      supabase.rpc("list_mcq_bank_subfolder_practice_progress", {
        p_folder_id: folder.id,
      }),
    ]);
    folderProgress = normalizeFolderPracticeProgress(
      (prog ?? {}) as Record<string, unknown>,
      folder.id
    );
    subfolders = ((subProg ?? []) as SubfolderProgressRow[]).map((s) => {
      const p = normalizeSubfolderPracticeProgress(
        {
          subfolder_id: s.subfolder_id,
          total: s.total,
          done: s.done,
          remaining: s.remaining,
          percent_complete: s.percent_complete,
          complete: s.complete,
        },
        s.subfolder_id
      );
      return {
        id: s.subfolder_id,
        name: s.name,
        sort_order: Number(s.sort_order ?? 0),
        done: p.done,
        total: p.total,
      };
    });
  } else {
    const { data: subRows } = await supabase
      .from("mcq_bank_subfolders")
      .select("id, name, sort_order")
      .eq("folder_id", folder.id)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name");
    subfolders = ((subRows ?? []) as Array<{
      id: string;
      name: string;
      sort_order: number;
    }>).map((s) => ({ ...s, done: 0, total: 0 }));
  }

  const hasPdfs = materials.length > 0;

  return (
    <StudentPage>
      {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
      <PageHeader
        title={folder.name}
        description="Study material and practice subfolders for this folder."
        actions={
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to folders
          </Link>
        }
      />

      {!accessible ? (
        <div className="grid gap-4">
          <Card className="shadow-none opacity-90">
            <CardHeader>
              <CardTitle className="text-lg text-[var(--student-ink)]">
                Folder locked
              </CardTitle>
              <CardDescription>
                PDFs and practice unlock with a live subscription or grant for
                this Block.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResourceLockNotice />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-8">
          {folderProgress.total > 0 ? (
            <div className="flex items-center gap-4">
              <McqFolderProgressRing
                done={folderProgress.done}
                total={folderProgress.total}
                size={52}
                className="shrink-0"
              />
              <p className="text-sm text-muted-foreground">
                Folder progress: {folderProgress.done} of {folderProgress.total}{" "}
                complete across subfolders
              </p>
            </div>
          ) : null}

          <section className="grid gap-3">
            <h2 className="text-lg font-semibold text-[var(--student-ink)]">
              Study material
            </h2>
            {!hasPdfs ? (
              <p className="text-sm text-muted-foreground">
                No PDFs in this folder.
              </p>
            ) : (
              <ul className="grid gap-3">
                {materials.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl border bg-card p-4 shadow-none"
                  >
                    <MaterialOpenLink
                      materialId={m.id}
                      kind={m.kind}
                      title={m.title}
                    />
                    {m.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {m.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="text-lg font-semibold text-[var(--student-ink)]">
              Practice subfolders
            </h2>
            {subfolders.length === 0 ? (
              <EmptyState
                title="No subfolders yet"
                description="When your academy creates subfolders in this folder, they appear here for practice."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {subfolders.map((s) => (
                  <Link
                    key={s.id}
                    href={subfolderHref(blockSlug, folder.id, s.id)}
                  >
                    <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div className="min-w-0">
                          <CardTitle className="text-lg text-[var(--student-ink)]">
                            {s.name}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {s.total === 0
                              ? "Open subfolder"
                              : `${s.done} of ${s.total} complete`}
                          </CardDescription>
                        </div>
                        {s.total > 0 ? (
                          <McqFolderProgressRing
                            done={s.done}
                            total={s.total}
                            size={52}
                            className="shrink-0"
                          />
                        ) : null}
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </StudentPage>
  );
}
