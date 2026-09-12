"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createQuestion,
  saveNewVersion,
  updateQuestionMeta,
  type QuestionContent,
} from "@/lib/actions/questions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type CurriculumData = {
  years: { id: string; year_number: number }[];
  subjects: { id: string; name: string; year_id: string }[];
  books: { id: string; name: string; subject_id: string }[];
  chapters: { id: string; name: string; book_id: string }[];
  topics: { id: string; name: string; chapter_id: string }[];
};

export type EditorInitial = {
  questionId?: string;
  stem?: string;
  options?: { key: string; text: string }[];
  correct_key?: string;
  explanation?: string;
  reference?: string;
  difficulty?: "easy" | "medium" | "hard";
  tags?: string[];
  status?: string;
  year_id?: string;
  subject_id?: string;
  book_id?: string;
  chapter_id?: string;
  topic_id?: string;
};

const KEYS = ["A", "B", "C", "D", "E"];

export function QuestionEditor({
  curriculum,
  initial,
}: {
  curriculum: CurriculumData;
  initial?: EditorInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(initial?.questionId);

  const [yearId, setYearId] = useState(initial?.year_id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subject_id ?? "");
  const [bookId, setBookId] = useState(initial?.book_id ?? "");
  const [chapterId, setChapterId] = useState(initial?.chapter_id ?? "");
  const [topicId, setTopicId] = useState(initial?.topic_id ?? "");

  const [stem, setStem] = useState(initial?.stem ?? "");
  const [options, setOptions] = useState<string[]>(
    initial?.options
      ? KEYS.map((k) => initial.options!.find((o) => o.key === k)?.text ?? "")
      : ["", "", "", "", ""]
  );
  const [correctKey, setCorrectKey] = useState(initial?.correct_key ?? "A");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "medium");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [showAnswer, setShowAnswer] = useState(true);

  const subjects = useMemo(
    () => curriculum.subjects.filter((s) => s.year_id === yearId),
    [curriculum, yearId]
  );
  const books = useMemo(
    () => curriculum.books.filter((b) => b.subject_id === subjectId),
    [curriculum, subjectId]
  );
  const chapters = useMemo(
    () => curriculum.chapters.filter((c) => c.book_id === bookId),
    [curriculum, bookId]
  );
  const topics = useMemo(
    () => curriculum.topics.filter((t) => t.chapter_id === chapterId),
    [curriculum, chapterId]
  );

  const filledOptions = KEYS.map((k, i) => ({ key: k, text: options[i].trim() }))
    .filter((o) => o.text !== "");

  const valid =
    stem.trim() !== "" &&
    filledOptions.length >= 4 &&
    filledOptions.some((o) => o.key === correctKey) &&
    topicId !== "";

  function buildContent(): QuestionContent {
    return {
      stem: stem.trim(),
      options: filledOptions,
      correct_key: correctKey,
      explanation: explanation.trim(),
      reference: reference.trim(),
    };
  }

  function save() {
    startTransition(async () => {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (isEdit) {
        const metaRes = await updateQuestionMeta(initial!.questionId!, {
          topic_id: topicId,
          difficulty,
          tags: tagList,
        });
        if (metaRes.error) return void toast.error(metaRes.error);
        const res = await saveNewVersion(initial!.questionId!, buildContent());
        if (res.error) return void toast.error(res.error);
        toast.success("Saved as a new version");
        router.refresh();
      } else {
        const res = await createQuestion(buildContent(), {
          topic_id: topicId,
          difficulty,
          tags: tagList,
          status,
        });
        if (res.error) return void toast.error(res.error);
        toast.success("Question created");
        router.push(`/admin/questions/${res.id}`);
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* form */}
      <div className="grid content-start gap-4">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          <HierarchySelect label="Year" value={yearId} onChange={(v) => { setYearId(v); setSubjectId(""); setBookId(""); setChapterId(""); setTopicId(""); }}
            items={curriculum.years.map((y) => ({ id: y.id, name: `Year ${y.year_number}` }))} />
          <HierarchySelect label="Subject" value={subjectId} onChange={(v) => { setSubjectId(v); setBookId(""); setChapterId(""); setTopicId(""); }} items={subjects} disabled={!yearId} />
          <HierarchySelect label="Book" value={bookId} onChange={(v) => { setBookId(v); setChapterId(""); setTopicId(""); }} items={books} disabled={!subjectId} />
          <HierarchySelect label="Chapter" value={chapterId} onChange={(v) => { setChapterId(v); setTopicId(""); }} items={chapters} disabled={!bookId} />
          <HierarchySelect label="Topic" value={topicId} onChange={setTopicId} items={topics} disabled={!chapterId} />
        </div>

        <div className="grid gap-2">
          <Label>Question stem</Label>
          <Textarea
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            rows={4}
            placeholder="Which of the following…"
          />
        </div>

        <div className="grid gap-2">
          <Label>Options (A–D required, E optional) — select the correct one</Label>
          <RadioGroup value={correctKey} onValueChange={setCorrectKey}>
            {KEYS.map((k, i) => (
              <div key={k} className="flex items-center gap-2">
                <RadioGroupItem value={k} id={`correct-${k}`} />
                <span className="w-4 text-sm font-medium">{k}</span>
                <Input
                  value={options[i]}
                  onChange={(e) =>
                    setOptions((o) => o.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder={i === 4 ? "Option E (optional)" : `Option ${k}`}
                />
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="grid gap-2">
          <Label>Explanation</Label>
          <Textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            placeholder="Why the correct answer is correct…"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-2">
            <Label>Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Robbins, Chapter 4"
            />
          </div>
          <div className="grid gap-2">
            <Label>Difficulty</Label>
            <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Tags (comma separated)</Label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="virchow, thrombosis"
          />
        </div>

        {!isEdit && (
          <div className="grid gap-2">
            <Label>Initial status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Button onClick={save} disabled={!valid || pending}>
            {pending
              ? "Saving…"
              : isEdit
                ? "Save as new version"
                : "Create question"}
          </Button>
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              Content edits always create a new immutable version. Published
              tests keep the version they froze.
            </p>
          )}
        </div>
      </div>

      {/* live student-view preview */}
      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Student view preview</CardTitle>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Show answer
            <Switch checked={showAnswer} onCheckedChange={setShowAnswer} />
          </label>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="whitespace-pre-wrap text-sm">
            {stem.trim() || <span className="text-muted-foreground">Question stem…</span>}
          </p>
          <div className="grid gap-2">
            {filledOptions.map((o) => (
              <div
                key={o.key}
                className={`rounded-md border p-2 text-sm ${
                  showAnswer && o.key === correctKey
                    ? "border-green-600 bg-green-50 dark:bg-green-950"
                    : ""
                }`}
              >
                <span className="mr-2 font-medium">{o.key}.</span>
                {o.text}
              </div>
            ))}
            {filledOptions.length < 4 && (
              <p className="text-xs text-muted-foreground">
                Fill at least options A–D…
              </p>
            )}
          </div>
          {showAnswer && (explanation.trim() || reference.trim()) && (
            <div className="rounded-md bg-muted p-3 text-sm">
              {explanation.trim() && (
                <p className="whitespace-pre-wrap">{explanation}</p>
              )}
              {reference.trim() && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reference: {reference}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HierarchySelect({
  label,
  value,
  onChange,
  items,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
