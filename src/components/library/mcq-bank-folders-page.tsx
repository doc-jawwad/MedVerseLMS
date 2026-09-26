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

type FolderRow = {
  id: string;
  name: string;
  sort_order: number;
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

  const [{ data: granted }, { data: folderRows }] = await Promise.all([
    supabase.rpc("has_practice_access", { p_subject_id: subjectId }),
    supabase
      .from("mcq_bank_folders")
      .select("id, name, sort_order")
      .eq("academic_product_subject_id", subjectId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name"),
  ]);

  const accessible = granted === true;
  const folders = (folderRows ?? []) as FolderRow[];

  const pageTitle = title ?? "MCQ Bank";
  const pageDescription =
    description ?? "Open a folder for study PDFs and practice MCQs.";

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <Link key={f.id} href={folderHref(blockSlug, "mcq-bank", f.id)}>
              <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-lg text-[var(--student-ink)]">
                    {f.name}
                  </CardTitle>
                  <CardDescription>Open folder</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </StudentPage>
  );
}
