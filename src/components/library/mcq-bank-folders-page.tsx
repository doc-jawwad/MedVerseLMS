import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";
import { folderHref } from "@/lib/academic-tree";
import { McqFolderProgressRing } from "@/components/library/mcq-folder-progress-ring";
import { normalizeFolderPracticeProgress } from "@/lib/practice/mcq-bank-folder-progress";

type FolderProgressRow = {
  folder_id: string;
  name: string;
  sort_order: number;
  total: number | string;
  done: number | string;
  remaining: number | string;
  percent_complete: number | string;
  complete: boolean;
};

/**
 * Academic Block MCQ Bank — folders under the product subject.
 * Entitlement gated by has_practice_access on the product subject.
 */
export async function McqBankFoldersPage({
  subjectId,
  breadcrumbs,
  title,
  description,
  backHref,
  blockSlug,
}: {
  subjectId: string;
  breadcrumbs?: BreadcrumbCrumb[];
  title?: string;
  description?: string;
  backHref?: string;
  /** Product key for folder detail URLs. */
  blockSlug: string;
}) {
  const { supabase } = await requireStudent();

  const { data: granted } = await supabase.rpc("has_practice_access", {
    p_subject_id: subjectId,
  });
  const accessible = granted === true;

  let folders: Array<{
    id: string;
    name: string;
    sort_order: number;
    done: number;
    total: number;
  }> = [];

  if (accessible) {
    const { data } = await supabase.rpc(
      "list_mcq_bank_folder_practice_progress",
      { p_product_subject_id: subjectId }
    );
    folders = ((data ?? []) as FolderProgressRow[]).map((f) => {
      const p = normalizeFolderPracticeProgress(
        {
          folder_id: f.folder_id,
          total: f.total,
          done: f.done,
          remaining: f.remaining,
          percent_complete: f.percent_complete,
          complete: f.complete,
        },
        f.folder_id
      );
      return {
        id: f.folder_id,
        name: f.name,
        sort_order: f.sort_order,
        done: p.done,
        total: p.total,
      };
    });
  } else {
    const { data: folderRows } = await supabase
      .from("mcq_bank_folders")
      .select("id, name, sort_order")
      .eq("academic_product_subject_id", subjectId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name");
    folders = ((folderRows ?? []) as Array<{
      id: string;
      name: string;
      sort_order: number;
    }>).map((f) => ({ ...f, done: 0, total: 0 }));
  }

  const pageTitle = title ?? "MCQ Bank";
  const pageDescription =
    description ??
    "Open a folder for study PDFs and practice MCQs in its subfolders.";

  const aggregate =
    accessible && folders.length > 0
      ? folders.reduce(
          (acc, f) => ({
            done: acc.done + f.done,
            total: acc.total + f.total,
          }),
          { done: 0, total: 0 }
        )
      : null;

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

      {!accessible ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Card className="shadow-none opacity-90">
                <CardHeader>
                  <CardTitle className="text-lg text-[var(--student-ink)]">
                    MCQ Bank locked
                  </CardTitle>
                  <CardDescription>
                    Practice unlocks with a live subscription or grant for this
                    Block.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResourceLockNotice />
                </CardContent>
              </Card>
            </div>
          ) : (
            folders.map((f) => (
              <Card key={f.id} className="h-full shadow-none opacity-90">
                <CardHeader>
                  <CardTitle className="text-lg text-[var(--student-ink)]">
                    {f.name}
                  </CardTitle>
                  <CardDescription>Practice folder</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResourceLockNotice />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : folders.length === 0 ? (
        <EmptyState
          title="No folders yet"
          description="When your academy creates MCQ Bank folders for this Block, they appear here."
        />
      ) : (
        <div className="grid gap-4">
          {aggregate && aggregate.total > 0 ? (
            <p className="text-sm text-muted-foreground">
              Bank progress: {aggregate.done} of {aggregate.total} complete
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <Link key={f.id} href={folderHref(blockSlug, "mcq-bank", f.id)}>
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="text-lg text-[var(--student-ink)]">
                      {f.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {f.total === 0
                        ? "Open folder"
                        : `${f.done} of ${f.total} complete`}
                    </CardDescription>
                  </div>
                  {f.total > 0 ? (
                    <McqFolderProgressRing
                      done={f.done}
                      total={f.total}
                      size={52}
                      className="shrink-0"
                    />
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
          </div>
        </div>
      )}
    </StudentPage>
  );
}
