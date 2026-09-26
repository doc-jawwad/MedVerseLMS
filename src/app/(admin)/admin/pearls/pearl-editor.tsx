"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { yearDisplayName } from "@/lib/library/types";
import { toast } from "sonner";
import {
  createPearlPoint,
  deletePearlPoint,
  setPearlStatus,
  updatePearlPoint,
  attachPearlSourcePdf,
  clearPearlSourcePdf,
  type PearlInput,
} from "@/lib/actions/pearls";
import { studyErrorMessage } from "@/lib/study/errors";
import { StudyMarkdown } from "@/components/study/study-markdown";
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

type Year = { id: string; year_number: number; name?: string | null };
type Subject = { id: string; name: string; year_id: string };
type Chapter = { id: string; name: string; subject_id: string };
type Topic = { id: string; name: string; chapter_id: string };

export function PearlEditor({
  years,
  subjects,
  chapters = [],
  topics = [],
  pearlId,
  initial,
  lockYear,
  hasSourcePdf = false,
  sourcePdfBytes = null,
}: {
  years: Year[];
  subjects: Subject[];
  chapters?: Chapter[];
  topics?: Topic[];
  pearlId?: string;
  lockYear?: boolean;
  hasSourcePdf?: boolean;
  sourcePdfBytes?: number | null;
  initial?: {
    prompt: string;
    answer: string;
    explanation: string;
    year_id: string;
    subject_id: string;
    chapter_id?: string | null;
    topic_id?: string | null;
    status: "draft" | "published";
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [yearId, setYearId] = useState(initial?.year_id ?? years[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? "");
  const [topicId, setTopicId] = useState(initial?.topic_id ?? "");
  const [status, setStatus] = useState<"draft" | "published">(
    initial?.status ?? "draft"
  );
  const [preview, setPreview] = useState(false);
  const [pdfAttached, setPdfAttached] = useState(hasSourcePdf);
  const [pdfBytes, setPdfBytes] = useState<number | null>(sourcePdfBytes);

  const yearSubjects = subjects.filter((s) => s.year_id === yearId);
  const subjectChapters = chapters.filter((c) => c.subject_id === subjectId);
  const chapterTopics = topics.filter((t) => t.chapter_id === chapterId);
  const lockedYear = years.find((y) => y.id === yearId);

  function build(): PearlInput {
    return {
      prompt,
      answer,
      explanation,
      yearId,
      subjectId,
      chapterId: chapterId || null,
      topicId: topicId || null,
      status,
    };
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pearl-prompt">Prompt</Label>
          <Textarea
            id="pearl-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            data-testid="pearl-prompt"
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pearl-answer">Answer</Label>
          <Textarea
            id="pearl-answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            data-testid="pearl-answer"
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pearl-explanation">Explanation (optional)</Label>
          <Textarea
            id="pearl-explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={4}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Class</Label>
          {lockYear ? (
            <Input
              value={yearDisplayName(lockedYear ?? { year_number: 0 })}
              disabled
            />
          ) : (
            <Select value={yearId} onValueChange={setYearId}>
              <SelectTrigger>
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {yearDisplayName(y)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label>Subject</Label>
          <Select
            value={subjectId}
            onValueChange={(v) => {
              setSubjectId(v);
              setChapterId("");
              setTopicId("");
            }}
          >
            <SelectTrigger data-testid="pearl-subject">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              {yearSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Chapter (optional)</Label>
          <Select
            value={chapterId || "__none__"}
            onValueChange={(v) => {
              setChapterId(v === "__none__" ? "" : v);
              setTopicId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Chapter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              {subjectChapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Topic (optional)</Label>
          <Select
            value={topicId || "__none__"}
            onValueChange={(v) => setTopicId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Topic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              {chapterTopics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pearlId ? (
        <div
          className="grid gap-2 rounded-xl border p-3"
          data-testid="pearl-source-pdf"
        >
          <p className="text-sm font-medium text-[var(--student-ink)]">
            Optional source PDF
          </p>
          <p className="text-xs text-muted-foreground">
            Private study-content storage (same R2 path as materials). Students
            open it only after they can access this One Liner.
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
              data-testid="pearl-pdf-input"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("pdf", file);
                  const { error } = await attachPearlSourcePdf(pearlId, fd);
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
                    const { error } = await clearPearlSourcePdf(pearlId);
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
          Save this One Liner first, then you can attach an optional source PDF.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={pending}
          data-testid="pearl-save"
          onClick={() =>
            startTransition(async () => {
              if (pearlId) {
                const { error } = await updatePearlPoint(pearlId, build());
                if (error) toast.error(error);
                else {
                  toast.success("Saved");
                  router.refresh();
                }
              } else {
                const res = await createPearlPoint(build());
                if ("error" in res && res.error) toast.error(res.error);
                else if ("id" in res && res.id) {
                  toast.success("Created");
                  router.push(`/admin/pearls/${res.id}`);
                }
              }
            })
          }
        >
          {pearlId ? "Save" : "Create"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? "Hide preview" : "Preview"}
        </Button>
        {pearlId ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const next = status === "published" ? "draft" : "published";
                  const { error } = await setPearlStatus(pearlId, next);
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
                  if (
                    !window.confirm(
                      "Move this One Liner to the Bin? Recoverable for ~7 days. This is not a permanent delete."
                    )
                  ) {
                    return;
                  }
                  const { error } = await deletePearlPoint(pearlId);
                  if (error) toast.error(error);
                  else toast.success("Moved to Bin");
                })
              }
            >
              Move to Bin
            </Button>
          </>
        ) : null}
      </div>
      {preview && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-semibold tracking-wide text-[var(--brand-teal-ink)] uppercase">
            Student preview
          </p>
          <p className="mt-3 text-lg font-medium text-[var(--student-ink)]">
            {prompt || "Prompt"}
          </p>
          <div className="mt-4 rounded-lg bg-muted/60 p-3">
            <p className="text-sm font-semibold">Answer</p>
            <p>{answer || "—"}</p>
            {explanation ? (
              <div className="mt-2 text-sm text-muted-foreground">
                <StudyMarkdown source={explanation} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
