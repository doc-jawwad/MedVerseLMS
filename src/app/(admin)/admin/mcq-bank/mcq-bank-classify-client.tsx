"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignUnassignedQuestionToSubfolder } from "@/lib/actions/mcq-bank-subfolders";

export type UnassignedQuestionRow = {
  question_id: string;
  status: string;
  difficulty: string | null;
  stem: string | null;
  subject_name: string | null;
  topic_name: string | null;
};

export type ProductSubjectOption = {
  id: string;
  name: string;
  product_key: string;
};

export type FolderOption = {
  folder_id: string;
  name: string;
  product_subject_id: string;
};

export type SubfolderOption = {
  subfolder_id: string;
  name: string;
  folder_id: string;
};

export function McqBankClassifyClient({
  yearId,
  subjects,
  folders,
  subfolders,
  questions,
  totalCount,
  page,
  pageSize,
}: {
  yearId: string;
  subjects: ProductSubjectOption[];
  folders: FolderOption[];
  subfolders: SubfolderOption[];
  questions: UnassignedQuestionRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [subfolderByQuestion, setSubfolderByQuestion] = useState<
    Record<string, string>
  >({});

  const subjectFolders = useMemo(
    () => folders.filter((f) => f.product_subject_id === subjectId),
    [folders, subjectId]
  );

  const subjectFolderIds = useMemo(
    () => new Set(subjectFolders.map((f) => f.folder_id)),
    [subjectFolders]
  );

  const subjectSubfolders = useMemo(() => {
    const folderName = new Map(
      subjectFolders.map((f) => [f.folder_id, f.name] as const)
    );
    return subfolders
      .filter((s) => subjectFolderIds.has(s.folder_id))
      .map((s) => ({
        ...s,
        label: `${folderName.get(s.folder_id) ?? "Folder"} / ${s.name}`,
      }));
  }, [subfolders, subjectFolderIds, subjectFolders]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function subfolderFor(questionId: string) {
    return (
      subfolderByQuestion[questionId] ??
      subjectSubfolders[0]?.subfolder_id ??
      ""
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          Content
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Classify unassigned MCQs
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Questions without an Academic MCQ Bank subfolder ({totalCount} for
          this class). Assign each to a product subject subfolder.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/admin/mcq-bank?year=${yearId}`}
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            MCQ Bank folders
          </Link>
        </div>
      </div>

      <div className="grid max-w-md gap-1">
        <Label className="text-xs">Product subject</Label>
        <Select
          value={subjectId || undefined}
          onValueChange={(v) => {
            setSubjectId(v);
            setSubfolderByQuestion({});
          }}
          disabled={subjects.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select product subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No unassigned questions for this class.
        </p>
      ) : (
        <ul className="grid gap-3">
          {questions.map((q) => {
            const selectedSubfolder = subfolderFor(q.question_id);
            return (
              <li
                key={q.question_id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/admin/questions/${q.question_id}`}
                    className="line-clamp-3 text-sm font-medium hover:underline"
                  >
                    {q.stem || "(no stem)"}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      {q.status.replace("_", " ")}
                    </Badge>
                    {q.difficulty ? <span>{q.difficulty}</span> : null}
                    {q.subject_name ? <span>{q.subject_name}</span> : null}
                    {q.topic_name ? <span>· {q.topic_name}</span> : null}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <Label className="text-xs">Subfolder</Label>
                    <Select
                      value={selectedSubfolder || undefined}
                      onValueChange={(v) =>
                        setSubfolderByQuestion((prev) => ({
                          ...prev,
                          [q.question_id]: v,
                        }))
                      }
                      disabled={subjectSubfolders.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select subfolder" />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectSubfolders.map((s) => (
                          <SelectItem
                            key={s.subfolder_id}
                            value={s.subfolder_id}
                          >
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={pending || !selectedSubfolder}
                    onClick={() =>
                      startTransition(async () => {
                        const subj = subjects.find((s) => s.id === subjectId);
                        const { error } =
                          await assignUnassignedQuestionToSubfolder(
                            q.question_id,
                            selectedSubfolder,
                            subj?.product_key
                          );
                        if (error) toast.error(error);
                        else {
                          toast.success("Assigned to subfolder");
                          router.refresh();
                        }
                      })
                    }
                  >
                    Assign
                  </Button>
                </div>
              </li>
            );
          })}
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
                href={`/admin/mcq-bank/classify?year=${yearId}&page=${Math.max(0, page - 1)}`}
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
                href={`/admin/mcq-bank/classify?year=${yearId}&page=${page + 1}`}
              >
                Next
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
