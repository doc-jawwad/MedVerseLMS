"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createManualTestQuestion } from "@/lib/actions/tests";
import { listCurriculumChildren } from "@/lib/actions/curriculum";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const KEYS = ["A", "B", "C", "D", "E"] as const;

type Named = { id: string; name: string };

export function TestBuilderManualMcq({
  testId,
  yearId,
  yearLabel,
  subjects,
}: {
  testId: string;
  yearId: string;
  yearLabel: string;
  /** Year-scoped subjects only — books/chapters/topics load on demand. */
  subjects: { id: string; name: string; year_id: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subjectId, setSubjectId] = useState("");
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [books, setBooks] = useState<Named[]>([]);
  const [chapters, setChapters] = useState<Named[]>([]);
  const [topics, setTopics] = useState<Named[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);

  const [stem, setStem] = useState("");
  const [options, setOptions] = useState(["", "", "", "", ""]);
  const [correctKey, setCorrectKey] = useState("A");
  const [explanation, setExplanation] = useState("");
  const [reference, setReference] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">(
    "medium"
  );

  // yearId is locked for the test; subjects prop is already year-scoped.
  void yearId;

  useEffect(() => {
    if (!subjectId) {
      setBooks([]);
      return;
    }
    let cancelled = false;
    setLoadingBooks(true);
    void listCurriculumChildren("books", subjectId).then((res) => {
      if (cancelled) return;
      setLoadingBooks(false);
      if (res.error) {
        toast.error(res.error);
        setBooks([]);
        return;
      }
      setBooks(res.items);
    });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  useEffect(() => {
    if (!bookId) {
      setChapters([]);
      return;
    }
    let cancelled = false;
    setLoadingChapters(true);
    void listCurriculumChildren("chapters", bookId).then((res) => {
      if (cancelled) return;
      setLoadingChapters(false);
      if (res.error) {
        toast.error(res.error);
        setChapters([]);
        return;
      }
      setChapters(res.items);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    if (!chapterId) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    setLoadingTopics(true);
    void listCurriculumChildren("topics", chapterId).then((res) => {
      if (cancelled) return;
      setLoadingTopics(false);
      if (res.error) {
        toast.error(res.error);
        setTopics([]);
        return;
      }
      setTopics(res.items);
    });
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  const filledOptions = KEYS.map((k, i) => ({
    key: k,
    text: options[i].trim(),
  })).filter((o) => o.text !== "");

  const valid =
    stem.trim() !== "" &&
    filledOptions.length >= 4 &&
    filledOptions.some((o) => o.key === correctKey) &&
    topicId !== "";

  function resetForm() {
    setStem("");
    setOptions(["", "", "", "", ""]);
    setCorrectKey("A");
    setExplanation("");
    setReference("");
    setDifficulty("medium");
  }

  function save() {
    if (!valid) return;
    startTransition(async () => {
      const res = await createManualTestQuestion(
        testId,
        {
          stem: stem.trim(),
          options: filledOptions,
          correct_key: correctKey,
          explanation: explanation.trim(),
          reference: reference.trim(),
        },
        { topic_id: topicId, difficulty, tags: [] }
      );
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Question created and added to this test");
      resetForm();
      router.refresh();
    });
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 rounded-md border p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">Create MCQ inline</h3>
        <p className="text-xs text-muted-foreground">
          Year locked to {yearLabel}. Created as approved and added to this
          draft immediately.
        </p>
      </div>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid min-w-0 gap-1">
          <Label>Subject</Label>
          <Select
            value={subjectId || undefined}
            onValueChange={(v) => {
              setSubjectId(v);
              setBookId("");
              setChapterId("");
              setTopicId("");
              setChapters([]);
              setTopics([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Subject" />
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
        <div className="grid gap-1">
          <Label>Book</Label>
          <Select
            value={bookId || undefined}
            disabled={!subjectId || loadingBooks}
            onValueChange={(v) => {
              setBookId(v);
              setChapterId("");
              setTopicId("");
              setTopics([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingBooks ? "Loading…" : "Book"} />
            </SelectTrigger>
            <SelectContent>
              {books.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Chapter</Label>
          <Select
            value={chapterId || undefined}
            disabled={!bookId || loadingChapters}
            onValueChange={(v) => {
              setChapterId(v);
              setTopicId("");
            }}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={loadingChapters ? "Loading…" : "Chapter"}
              />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Topic</Label>
          <Select
            value={topicId || undefined}
            disabled={!chapterId || loadingTopics}
            onValueChange={setTopicId}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingTopics ? "Loading…" : "Topic"} />
            </SelectTrigger>
            <SelectContent>
              {topics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid min-w-0 gap-2">
        <Label>Stem</Label>
        <Textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          rows={3}
          placeholder="Which of the following…"
          className="min-w-0 max-w-full"
        />
      </div>

      <div className="grid min-w-0 gap-2">
        <Label>Options (A–D required, E optional)</Label>
        <RadioGroup value={correctKey} onValueChange={setCorrectKey}>
          {KEYS.map((k, i) => (
            <div key={k} className="flex min-w-0 items-center gap-2">
              <RadioGroupItem value={k} id={`manual-correct-${k}`} />
              <span className="w-4 shrink-0 text-sm font-medium">{k}</span>
              <Input
                value={options[i]}
                onChange={(e) =>
                  setOptions((o) =>
                    o.map((v, j) => (j === i ? e.target.value : v))
                  )
                }
                placeholder={i === 4 ? "Option E (optional)" : `Option ${k}`}
                className="min-w-0 flex-1"
              />
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>Difficulty</Label>
          <Select
            value={difficulty}
            onValueChange={(v) =>
              setDifficulty(v as "easy" | "medium" | "hard")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">easy</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="hard">hard</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Reference (optional)</Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-1">
        <Label>Explanation (optional)</Label>
        <Textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
        />
      </div>

      <Button
        className="w-fit"
        disabled={!valid || pending}
        onClick={save}
        data-testid="create-manual-test-question"
      >
        Create & add to test
      </Button>
    </div>
  );
}
