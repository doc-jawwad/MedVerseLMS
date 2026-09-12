"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PracticeQuestion = {
  question_id: string;
  question_version_id: string;
  stem: string;
  options: { key: string; text: string }[];
  difficulty: string;
};

type Feedback = {
  is_correct: boolean;
  correct_key: string;
  explanation: string;
  reference: string;
};

const BATCH_SIZE = 10;

export function PracticeSession({
  scopeType,
  scopeId,
  title,
}: {
  scopeType: string;
  scopeId: string;
  title: string;
}) {
  const supabase = useRef(createClient()).current;
  const [queue, setQueue] = useState<PracticeQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ answered: 0, correct: 0 });

  const fetchBatch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_practice_batch", {
      p_scope_type: scopeType,
      p_scope_id: scopeId,
      p_limit: BATCH_SIZE,
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.includes("practice_access_denied")
          ? "You don't have practice access for this subject. Ask your admin."
          : error.message
      );
      return [] as PracticeQuestion[];
    }
    return (data ?? []) as PracticeQuestion[];
  }, [supabase, scopeType, scopeId]);

  const initialFetchStarted = useRef(false);
  useEffect(() => {
    if (initialFetchStarted.current) return;
    initialFetchStarted.current = true;
    void fetchBatch().then((batch) => setQueue(batch));
  }, [fetchBatch]);

  const current = queue[index];

  async function check() {
    if (!current || !selected) return;
    setChecking(true);
    const { data, error } = await supabase.rpc("submit_practice_answer", {
      p_question_version_id: current.question_version_id,
      p_selected_key: selected,
    });
    setChecking(false);
    if (error) {
      setError(error.message);
      return;
    }
    const fb = (data as Feedback[])[0];
    fb.correct_key = fb.correct_key.trim();
    setFeedback(fb);
    setStats((s) => ({
      answered: s.answered + 1,
      correct: s.correct + (fb.is_correct ? 1 : 0),
    }));
  }

  async function next() {
    setSelected(null);
    setFeedback(null);
    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      const batch = await fetchBatch();
      setQueue(batch);
      setIndex(0);
    }
  }

  if (error) {
    return (
      <div className="grid gap-4">
        <p className="text-destructive">{error}</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/practice">Back to practice</Link>
        </Button>
      </div>
    );
  }

  if (loading && queue.length === 0) {
    return <p className="text-muted-foreground">Loading questions…</p>;
  }

  if (!current) {
    return (
      <div className="grid gap-4">
        <p className="text-muted-foreground">No questions available here yet.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/practice">Back to practice</Link>
        </Button>
      </div>
    );
  }

  const acc =
    stats.answered > 0 ? Math.round((100 * stats.correct) / stats.answered) : 0;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Question {index + 1} of {queue.length} in this round
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{current.difficulty}</Badge>
          {stats.answered > 0 && (
            <span className="text-muted-foreground">
              {stats.correct}/{stats.answered} correct ({acc}%)
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium leading-relaxed">
            {current.stem}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {current.options.map((o) => {
            const isSelected = selected === o.key;
            const isCorrect = feedback && o.key === feedback.correct_key;
            const isWrongPick =
              feedback && isSelected && !feedback.is_correct;
            return (
              <button
                key={o.key}
                disabled={Boolean(feedback)}
                onClick={() => setSelected(o.key)}
                className={`rounded-md border p-3 text-left text-sm transition-colors ${
                  isCorrect
                    ? "border-green-600 bg-green-50 dark:bg-green-950"
                    : isWrongPick
                      ? "border-red-600 bg-red-50 dark:bg-red-950"
                      : isSelected
                        ? "border-primary bg-accent"
                        : "hover:bg-accent/50"
                }`}
              >
                <span className="mr-2 font-semibold">{o.key}.</span>
                {o.text}
              </button>
            );
          })}

          {feedback && (
            <div
              className={`mt-2 rounded-md p-3 text-sm ${
                feedback.is_correct
                  ? "bg-green-50 dark:bg-green-950"
                  : "bg-red-50 dark:bg-red-950"
              }`}
            >
              <p className="font-medium">
                {feedback.is_correct
                  ? "✓ Correct"
                  : `✗ Incorrect — the correct answer is ${feedback.correct_key}.`}
              </p>
              {feedback.explanation && (
                <p className="mt-2 whitespace-pre-wrap">{feedback.explanation}</p>
              )}
              {feedback.reference && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reference: {feedback.reference}
                </p>
              )}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            {!feedback ? (
              <Button onClick={check} disabled={!selected || checking}>
                {checking ? "Checking…" : "Check answer"}
              </Button>
            ) : (
              <Button onClick={next} disabled={loading}>
                {loading ? "Loading…" : "Next question"}
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href="/practice">End session</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
