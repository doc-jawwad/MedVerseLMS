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
import { McqPracticePanel } from "@/components/library/mcq-folder-practice-panel";
import { normalizeSubfolderPracticeProgress } from "@/lib/practice/mcq-bank-folder-progress";

/**
 * Student MCQ Bank subfolder practice hub.
 */
export async function McqBankSubfolderDetailPage({
  subjectId,
  folderId,
  subfolderId,
  breadcrumbs,
  backHref,
}: {
  subjectId: string;
  folderId: string;
  subfolderId: string;
  breadcrumbs?: BreadcrumbCrumb[];
  backHref: string;
}) {
  const { supabase } = await requireStudent();

  const [{ data: granted }, { data: folder }] = await Promise.all([
    supabase.rpc("has_practice_access", { p_subject_id: subjectId }),
    supabase
      .from("mcq_bank_folders")
      .select("id, name, academic_product_subject_id")
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

  const { data: subfolder } = await supabase
    .from("mcq_bank_subfolders")
    .select("id, name, folder_id")
    .eq("id", subfolderId)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!subfolder) {
    return (
      <StudentPage>
        {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
        <EmptyState
          title="Subfolder not found"
          description="This MCQ Bank subfolder is unavailable."
        />
      </StudentPage>
    );
  }

  const accessible = granted === true;

  let progress = normalizeSubfolderPracticeProgress(
    {
      total: 0,
      done: 0,
      remaining: 0,
      percent_complete: 0,
      complete: false,
      favorites: 0,
      incorrect: 0,
    },
    subfolder.id
  );
  if (accessible) {
    const { data: prog } = await supabase.rpc(
      "get_mcq_bank_subfolder_practice_progress",
      { p_subfolder_id: subfolder.id }
    );
    progress = normalizeSubfolderPracticeProgress(
      (prog ?? {}) as Record<string, unknown>,
      subfolder.id
    );
  }

  return (
    <StudentPage>
      {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
      <PageHeader
        title={subfolder.name}
        description={`Practice MCQs in ${folder.name}.`}
        actions={
          <Link
            href={backHref}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to {folder.name}
          </Link>
        }
      />

      {!accessible ? (
        <div className="grid gap-4">
          <Card className="shadow-none opacity-90">
            <CardHeader>
              <CardTitle className="text-lg text-[var(--student-ink)]">
                Subfolder locked
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
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold text-[var(--student-ink)]">
            Practice MCQs
          </h2>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base text-[var(--student-ink)]">
                Subfolder practice
              </CardTitle>
              <CardDescription>
                Instant feedback. Unfinished MCQs are served first. Progress is
                yours alone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <McqPracticePanel
                containerKind="subfolder"
                containerId={subfolder.id}
                containerName={subfolder.name}
                progress={progress}
              />
            </CardContent>
          </Card>
        </section>
      )}
    </StudentPage>
  );
}
