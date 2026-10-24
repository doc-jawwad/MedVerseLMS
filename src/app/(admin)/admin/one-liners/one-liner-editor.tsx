"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createOneLiner,
  updateOneLiner,
  setOneLinerStatus,
  moveOneLinerToBin,
  attachOneLinerSourcePdf,
  clearOneLinerSourcePdf,
} from "@/lib/actions/one-liners";
import { studyErrorMessage } from "@/lib/study/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Subject = { id: string; name: string };

export function OneLinerEditor({
  yearId,
  subjects,
  linerId,
  hasSourcePdf = false,
  sourcePdfBytes = null,
  initial,
}: {
  yearId: string;
  subjects: Subject[];
  linerId?: string;
  hasSourcePdf?: boolean;
  sourcePdfBytes?: number | null;
  initial?: {
    title: string;
    body: string;
    subject_id: string;
    status: "draft" | "published";
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [status, setStatus] = useState<"draft" | "published">(
    initial?.status ?? "draft"
  );
  const [pdfAttached, setPdfAttached] = useState(hasSourcePdf);
  const [pdfBytes, setPdfBytes] = useState<number | null>(sourcePdfBytes);

  function save() {
    startTransition(async () => {
      if (linerId) {
        const { error } = await updateOneLiner(linerId, {
          title,
          body,
          subject_id: subjectId,
        });
        if (error) toast.error(error);
        else toast.success("Saved");
      } else {
        const res = await createOneLiner({
          year_id: yearId,
          subject_id: subjectId,
          title,
          body,
        });
        if ("error" in res && res.error) toast.error(res.error);
        else if ("id" in res) router.push(`/admin/one-liners/${res.id}`);
      }
    });
  }

  const canSave =
    title.trim().length > 0 && body.trim().length > 0 && subjectId.length > 0;

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="grid gap-2">
        <Label>Title / heading</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Digoxin toxicity mnemonics"
          disabled={pending}
        />
      </div>

      <div className="grid gap-2">
        <Label>Body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-32"
          placeholder="Key fact, mnemonic, or high-yield pearl…"
          disabled={pending}
        />
      </div>

      <div className="grid gap-2">
        <Label>Subject</Label>
        <Select
          value={subjectId || undefined}
          onValueChange={setSubjectId}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select subject" />
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

      {linerId ? (
        <div
          className="grid gap-2 rounded-xl border p-3"
          data-testid="one-liner-source-pdf"
        >
          <p className="text-sm font-medium text-[var(--student-ink)]">
            Optional source PDF
          </p>
          <p className="text-xs text-muted-foreground">
            Private study-content storage (same R2 path as materials). Students
            open it from the Prof. Session day One-Liners slot after they can
            view this item.
          </p>
          {pdfAttached ? (
            <p className="text-sm text-muted-foreground">
              Attached
              {pdfBytes ? ` (${Math.round(pdfBytes / 1024)} KB)` : ""}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No PDF attached.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept="application/pdf,.pdf"
              className="max-w-xs"
              data-testid="one-liner-pdf-input"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("pdf", file);
                  const { error } = await attachOneLinerSourcePdf(linerId, fd);
                  if (error) toast.error(studyErrorMessage(error));
                  else {
                    setPdfAttached(true);
                    setPdfBytes(file.size);
                    toast.success("PDF attached");
                    router.refresh();
                  }
                });
              }}
            />
            {pdfAttached ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const { error } = await clearOneLinerSourcePdf(linerId);
                    if (error) toast.error(studyErrorMessage(error));
                    else {
                      setPdfAttached(false);
                      setPdfBytes(null);
                      toast.success("PDF removed");
                      router.refresh();
                    }
                  })
                }
              >
                Remove PDF
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save this one-liner first, then you can attach an optional source PDF.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending || !canSave}>
          {pending ? "Saving…" : linerId ? "Save" : "Create draft"}
        </Button>

        {linerId && (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next: "draft" | "published" =
                    status === "published" ? "draft" : "published";
                  const { error } = await setOneLinerStatus(linerId, next);
                  if (error) toast.error(error);
                  else setStatus(next);
                })
              }
            >
              {status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (!window.confirm("Move to Bin? Recoverable for ~7 days."))
                    return;
                  const { error } = await moveOneLinerToBin(linerId);
                  if (error) toast.error(error);
                  else {
                    toast.success("Moved to Bin");
                    router.push("/admin/one-liners");
                  }
                })
              }
            >
              Move to Bin
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
