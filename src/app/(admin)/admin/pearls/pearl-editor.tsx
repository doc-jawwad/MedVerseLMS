"use client";

import { useState, useTransition } from "react";
import { yearDisplayName } from "@/lib/library/types";
import { toast } from "sonner";
import {
  createPearlPoint,
  deletePearlPoint,
  setPearlStatus,
  updatePearlPoint,
  type PearlInput,
} from "@/lib/actions/pearls";
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
}: {
  years: Year[];
  subjects: Subject[];
  chapters?: Chapter[];
  topics?: Topic[];
  pearlId?: string;
  lockYear?: boolean;
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
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [yearId, setYearId] = useState(initial?.year_id ?? years[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? "");
  const [topicId, setTopicId] = useState(initial?.topic_id ?? "");
  const [status, setStatus] = useState<"draft" | "published">(initial?.status ?? "draft");
  const [preview, setPreview] = useState(false);

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
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label>Question / point</Label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-24" />
        </div>
        <div className="grid gap-2">
          <Label>Answer</Label>
          <Input value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>Short explanation (optional)</Label>
          <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Year</Label>
            {lockYear ? (
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                {lockedYear ? yearDisplayName(lockedYear) : "Selected class"}
              </div>
            ) : (
              <Select value={yearId} onValueChange={(v) => { setYearId(v); setSubjectId(""); setChapterId(""); setTopicId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={y.id}>{yearDisplayName(y)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Subject</Label>
            <Select
              value={subjectId}
              onValueChange={(v) => { setSubjectId(v); setChapterId(""); setTopicId(""); }}
              disabled={!yearId}
            >
              <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
              <SelectContent>
                {yearSubjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Chapter / topic (optional)</Label>
            <Select
              value={chapterId || "none"}
              onValueChange={(v) => { setChapterId(v === "none" ? "" : v); setTopicId(""); }}
              disabled={!subjectId}
            >
              <SelectTrigger><SelectValue placeholder="Chapter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {subjectChapters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Topic (optional)</Label>
            <Select
              value={topicId || "none"}
              onValueChange={(v) => setTopicId(v === "none" ? "" : v)}
              disabled={!chapterId}
            >
              <SelectTrigger><SelectValue placeholder="Topic" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {chapterTopics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || !prompt.trim() || !answer.trim() || !subjectId}
            onClick={() =>
              startTransition(async () => {
                if (pearlId) {
                  const { error } = await updatePearlPoint(pearlId, build());
                  if (error) toast.error(error);
                  else toast.success("Saved");
                } else {
                  const res = await createPearlPoint(build());
                  if (res?.error) toast.error(res.error);
                }
              })
            }
          >
            {pending ? "Saving…" : pearlId ? "Save" : "Create draft"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPreview((v) => !v)}>
            {preview ? "Hide preview" : "Preview"}
          </Button>
          {pearlId && (
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
                    if (!window.confirm("Delete this pearl point?")) return;
                    const { error } = await deletePearlPoint(pearlId);
                    if (error) toast.error(error);
                  })
                }
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {preview && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-semibold tracking-wide text-[#05AEA9] uppercase">Student preview</p>
          <p className="mt-3 text-lg font-medium text-[#072855]">{prompt || "Prompt"}</p>
          <div className="mt-4 rounded-lg bg-[#072855]/5 p-3">
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
