"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StudyPdfUploader } from "@/components/admin/study-pdf-uploader";
import { MaterialOpenLink } from "@/components/study/material-open-link";
import {
  ConfirmDangerDialog,
  purgeDateHint,
} from "@/components/admin/confirm-danger-dialog";
import {
  createMcqBankSubfolder,
  renameMcqBankSubfolder,
  reorderMcqBankSubfolders,
  softDeleteMcqBankSubfolder,
} from "@/lib/actions/mcq-bank-subfolders";

export type McqBankSubfolderRow = {
  subfolder_id: string;
  name: string;
  sort_order: number;
  question_count: number;
};

export type FolderMaterialRow = {
  id: string;
  title: string;
  description: string;
  kind: string;
  status: string;
};

export function McqBankSubfoldersAdmin({
  yearId,
  productKey,
  folderId,
  folderName,
  subjectName,
  materialFolderId,
  materials,
  subfolders: initialSubfolders,
}: {
  yearId: string;
  productKey: string;
  folderId: string;
  folderName: string;
  subjectName: string;
  materialFolderId: string | null;
  materials: FolderMaterialRow[];
  subfolders: McqBankSubfolderRow[];
}) {
  const router = useRouter();
  const [subfolders, setSubfolders] = useState(initialSubfolders);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const sorted = useMemo(
    () =>
      [...subfolders].sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [subfolders]
  );

  function refresh() {
    router.refresh();
  }

  return (
    <div className="grid gap-8">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {subjectName}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          {folderName}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Manage subfolders (MCQs) and study PDFs for this folder. Open a
          subfolder to import or edit questions.
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
          <h2 className="text-lg font-semibold">Subfolders</h2>
          <p className="text-sm text-muted-foreground">
            Questions live in subfolders. Empty subfolders can be moved to the
            Bin.
          </p>
        </div>

        <form
          className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const { error, id } = await createMcqBankSubfolder(
                folderId,
                name,
                productKey
              );
              if (error) {
                toast.error(error);
                return;
              }
              toast.success("Subfolder created");
              setName("");
              if (id) {
                setSubfolders((prev) => [
                  ...prev,
                  {
                    subfolder_id: id,
                    name: name.trim(),
                    sort_order: prev.length,
                    question_count: 0,
                  },
                ]);
              }
              refresh();
            });
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="subfolder-name"
            >
              New subfolder name
            </label>
            <Input
              id="subfolder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Week 1 set"
              disabled={pending}
            />
          </div>
          <Button
            type="submit"
            disabled={pending || !name.trim()}
            className="w-full sm:w-auto"
          >
            Create subfolder
          </Button>
        </form>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subfolders yet. Create one to place Academic MCQs.
          </p>
        ) : (
          <ul className="grid gap-3">
            {sorted.map((subfolder, index) => (
              <li
                key={subfolder.subfolder_id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Input
                    className="max-w-full font-medium sm:max-w-sm"
                    defaultValue={subfolder.name}
                    disabled={pending}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === subfolder.name) return;
                      startTransition(async () => {
                        const { error } = await renameMcqBankSubfolder(
                          subfolder.subfolder_id,
                          next,
                          productKey,
                          folderId
                        );
                        if (error) toast.error(error);
                        else {
                          setSubfolders((prev) =>
                            prev.map((f) =>
                              f.subfolder_id === subfolder.subfolder_id
                                ? { ...f, name: next }
                                : f
                            )
                          );
                          toast.success("Renamed");
                          refresh();
                        }
                      });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {subfolder.question_count} question
                    {subfolder.question_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild type="button" size="sm" variant="secondary">
                    <Link
                      href={`/admin/mcq-bank/${productKey}/${folderId}/${subfolder.subfolder_id}?year=${yearId}`}
                    >
                      Open
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || index === 0}
                    onClick={() =>
                      startTransition(async () => {
                        const ids = sorted.map((f) => f.subfolder_id);
                        const next = [...ids];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        const { error } = await reorderMcqBankSubfolders(
                          folderId,
                          next,
                          productKey
                        );
                        if (error) toast.error(error);
                        else {
                          toast.success("Reordered");
                          refresh();
                        }
                      })
                    }
                  >
                    Move up
                  </Button>
                  <ConfirmDangerDialog
                    title="Delete empty subfolder?"
                    description={
                      <>
                        <p>
                          “{subfolder.name}” will be moved to the Bin if it has
                          no questions. It stays until about{" "}
                          <strong>{purgeDateHint()}</strong>.
                        </p>
                        <p className="mt-2">
                          Subfolders with questions cannot be deleted — remove
                          or move those MCQs first.
                        </p>
                      </>
                    }
                    confirmLabel="Move to Bin"
                    disabled={subfolder.question_count > 0}
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={pending || subfolder.question_count > 0}
                      >
                        Delete
                      </Button>
                    }
                    onConfirm={() =>
                      softDeleteMcqBankSubfolder(
                        subfolder.subfolder_id,
                        productKey,
                        folderId
                      )
                    }
                    onSuccess={() => {
                      setSubfolders((prev) =>
                        prev.filter(
                          (f) => f.subfolder_id !== subfolder.subfolder_id
                        )
                      );
                      refresh();
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
