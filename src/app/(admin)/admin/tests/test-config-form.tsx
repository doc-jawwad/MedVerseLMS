"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createTest,
  updateTestConfig,
  type TestConfig,
} from "@/lib/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Year = { id: string; year_number: number };
type Subject = { id: string; name: string; year_id: string };

// datetime-local <-> ISO helpers (local timezone)
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function TestConfigForm({
  years,
  subjects,
  testId,
  initial,
  readOnly,
}: {
  years: Year[];
  subjects: Subject[];
  testId?: string;
  initial?: Partial<TestConfig>;
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [yearId, setYearId] = useState(initial?.year_id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [opensAt, setOpensAt] = useState(toLocalInput(initial?.opens_at ?? null));
  const [closesAt, setClosesAt] = useState(toLocalInput(initial?.closes_at ?? null));
  const [duration, setDuration] = useState(initial?.duration_minutes ?? 60);
  const [marks, setMarks] = useState(initial?.marks_per_question ?? 1);
  const [negative, setNegative] = useState(initial?.negative_mark ?? 0);
  const [shuffleQ, setShuffleQ] = useState(initial?.shuffle_questions ?? true);
  const [shuffleO, setShuffleO] = useState(initial?.shuffle_options ?? false);
  const [showReview, setShowReview] = useState(initial?.show_review ?? "after_close");
  const [minQuestions, setMinQuestions] = useState(initial?.min_questions ?? 1);

  const yearSubjects = subjects.filter((s) => s.year_id === yearId);

  function buildConfig(): TestConfig {
    return {
      title: title.trim(),
      year_id: yearId,
      subject_id: subjectId || null,
      opens_at: fromLocalInput(opensAt),
      closes_at: fromLocalInput(closesAt),
      duration_minutes: Number(duration),
      marks_per_question: Number(marks),
      negative_mark: Number(negative),
      shuffle_questions: shuffleQ,
      shuffle_options: shuffleO,
      show_review: showReview as TestConfig["show_review"],
      min_questions: Number(minQuestions),
    };
  }

  function save() {
    startTransition(async () => {
      if (testId) {
        const { error } = await updateTestConfig(testId, buildConfig());
        if (error) toast.error(error);
        else toast.success("Saved");
      } else {
        const res = await createTest(buildConfig());
        if (res?.error) toast.error(res.error);
      }
    });
  }

  const disabled = readOnly || pending;

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="grid gap-2">
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Pathology Weekly Test #04" disabled={disabled} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Year</Label>
          <Select value={yearId || undefined} onValueChange={(v) => { setYearId(v); setSubjectId(""); }} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>Year {y.year_number}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Subject (optional)</Label>
          <Select value={subjectId || "none"} onValueChange={(v) => setSubjectId(v === "none" ? "" : v)} disabled={disabled || !yearId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Mixed —</SelectItem>
              {yearSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Opens at</Label>
          <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} disabled={disabled} />
        </div>
        <div className="grid gap-2">
          <Label>Closes at</Label>
          <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} disabled={disabled} />
        </div>
        <div className="grid gap-2">
          <Label>Duration (minutes)</Label>
          <Input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={disabled} />
        </div>
        <div className="grid gap-2">
          <Label>Minimum questions</Label>
          <Input type="number" min={1} value={minQuestions} onChange={(e) => setMinQuestions(Number(e.target.value))} disabled={disabled} />
        </div>
        <div className="grid gap-2">
          <Label>Marks per question</Label>
          <Input type="number" min={0.25} step={0.25} value={marks} onChange={(e) => setMarks(Number(e.target.value))} disabled={disabled} />
        </div>
        <div className="grid gap-2">
          <Label>Negative mark per wrong</Label>
          <Input type="number" min={0} step={0.25} value={negative} onChange={(e) => setNegative(Number(e.target.value))} disabled={disabled} />
        </div>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={shuffleQ} onCheckedChange={setShuffleQ} disabled={disabled} />
          Shuffle question order
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={shuffleO} onCheckedChange={setShuffleO} disabled={disabled} />
          Shuffle options
        </label>
      </div>

      <div className="grid max-w-xs gap-2">
        <Label>Answer review visible</Label>
        <Select value={showReview} onValueChange={(v) => setShowReview(v as typeof showReview)} disabled={disabled}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="after_submit">Right after submitting</SelectItem>
            <SelectItem value="after_close">After the test closes</SelectItem>
            <SelectItem value="never">Never</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!readOnly && (
        <Button onClick={save} disabled={pending || !title.trim() || !yearId} className="w-fit">
          {pending ? "Saving…" : testId ? "Save config" : "Create draft test"}
        </Button>
      )}
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          Config is frozen after publish (docs/test-rules.md).
        </p>
      )}
    </div>
  );
}
