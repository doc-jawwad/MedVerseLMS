import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";

type MaterialRow = {
  id: string;
  title: string;
  description: string;
  kind: string;
};

/**
 * Student MCQ Bank folder hub — PDFs + practice entry for one folder.
 */
export async function McqBankFolderDetailPage({
  subjectId,
  folderId,
  breadcrumbs,
  backHref,
}: {
  subjectId: string;
  folderId: string;
  breadcrumbs?: BreadcrumbCrumb[];
  backHref: string;
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

  const hasPdfs = materials.length > 0;

  return (
    <StudentPage>
      {breadcrumbs ? <AcademicBreadcrumbs crumbs={breadcrumbs} /> : null}
      <PageHeader
        title={folder.name}
        description="Study material and practice MCQs for this folder."
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
              Practice MCQs
            </h2>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base text-[var(--student-ink)]">
                  Folder practice
                </CardTitle>
                <CardDescription>
                  Practice with instant feedback. Only this folder&apos;s
                  approved MCQs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link
                    href={`/practice/session?scope=mcq_bank_folder&id=${encodeURIComponent(folder.id)}&name=${encodeURIComponent(folder.name)}`}
                  >
                    Start practice
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </StudentPage>
  );
}
