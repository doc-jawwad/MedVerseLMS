"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudyPdfUploader } from "@/components/admin/study-pdf-uploader";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import { removeQuestionFromMcqBankFolder } from "@/lib/actions/mcq-bank-folders";

export type FolderQuestionRow = {
  question_id: string;
  status: string;
  difficulty: string | null;
  stem: string | null;
  subject_name: string | null;
  topic_name: string | null;
};

export type FolderMaterialRow = {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: string;
};

export function McqBankFolderQuestions({
  yearId,
  productKey,
  folderId,
  folderName,
  subjectName,
  materialFolderId,
  materials,
  questions,
  totalCount,
  page,
  pageSize,
}: {
  yearId: string;
  productKey: string;
  folderId: string;
  folderName: string;
  subjectName: string;
  materialFolderId: string | null;
  materials: FolderMaterialRow[];
  questions: FolderQuestionRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const importHref = `/admin/questions/import?folderId=${encodeURIComponent(folderId)}&year=${yearId}`;

  return (
    <div className="grid gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {subjectName}
          </p>
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            {folderName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Folder content: PDFs and MCQs. Taxonomy metadata stays on each
            question for authoring/search.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href={`/admin/mcq-bank/${productKey}?year=${yearId}`}
              className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
            >
              Back to folders
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="w-fit shrink-0">
            <Link href={importHref}>Import CSV</Link>
          </Button>
          <Button asChild size="sm" className="w-fit shrink-0">
            <Link
              href={`/admin/questions/new?folderId=${folderId}&year=${yearId}`}
            >
              Add MCQ
            </Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4">
        <div>
          <h2 className="text-lg font-semibold">Study material (PDF)</h2>
          <p className="text-sm text-muted-foreground">
            Private R2 PDFs for this folder. Opens in the secure reader.
          </p>
        </div>
        {materialFolderId ? (
          <StudyPdfUploader
            folderId={materialFolderId}
            onComplete={() => router.refresh()}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            PDF storage is not ready for this folder. Refresh or recreate the
            folder.
          </p>
        )}
        {materials.length === 0 ? (
          <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
            No PDFs in this folder yet.
          </p>
        ) : (
          <ul className="grid gap-3">
            {materials.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <MaterialOpenLink
                    materialId={m.id}
                    kind={m.kind}
                    title={m.title}
                  />
                  {m.description ? (
                    <p className="text-sm text-muted-foreground">
                      {m.description}
                    </p>
                  ) : null}
                  <Badge variant="outline">{m.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-lg font-semibold">MCQs</h2>
          <p className="text-sm text-muted-foreground">
            {totalCount} question{totalCount === 1 ? "" : "s"} in this folder
          </p>
        </div>

        {questions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No questions in this folder yet. Import a CSV or add an MCQ.
          </p>
        ) : (
          <ul className="grid gap-3">
            {questions.map((q) => (
              <li
                key={q.question_id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Link
                    href={`/admin/questions/${q.question_id}`}
                    className="line-clamp-3 text-sm font-medium hover:underline"
                  >
                    {q.stem || "(no stem)"}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{q.status.replace("_", " ")}</Badge>
                    {q.difficulty ? <span>{q.difficulty}</span> : null}
                    {q.subject_name ? <span>{q.subject_name}</span> : null}
                    {q.topic_name ? <span>· {q.topic_name}</span> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Remove this question from the folder? It stays in the Question Bank as unassigned."
                      )
                    ) {
                      return;
                    }
                    startTransition(async () => {
                      const { error } = await removeQuestionFromMcqBankFolder(
                        q.question_id,
                        productKey
                      );
                      if (error) toast.error(error);
                      else {
                        toast.success("Removed from folder");
                        router.refresh();
                      }
                    });
                  }}
                >
                  Remove from folder
                </Button>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline" disabled={page <= 0}>
                <Link
                  href={`/admin/mcq-bank/${productKey}/${folderId}?year=${yearId}&page=${Math.max(0, page - 1)}`}
                  aria-disabled={page <= 0}
                >
                  Previous
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={page + 1 >= totalPages}
              >
                <Link
                  href={`/admin/mcq-bank/${productKey}/${folderId}?year=${yearId}&page=${page + 1}`}
                  aria-disabled={page + 1 >= totalPages}
                >
                  Next
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
