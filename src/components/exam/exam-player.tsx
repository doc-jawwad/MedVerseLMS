"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyServerExpiresAt,
  msRemainingFromServerClock,
} from "@/lib/exam/timer-deadline";
import {
  examOptionsFromRpc,
  type ExamOption,
} from "@/lib/exam/question-options";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ExamQuestion = {
  question_version_id: string;
  stem: string;
  /** Canonical array, or staging key→text object from start_attempt. */
  options: ExamOption[] | Record<string, string>;
};

export type AnswerState = {
  selected_key: string | null;
  marked_for_review: boolean;
};

export type ExamPlayerProps = {
  mode: "preview" | "live";
  title: string;
  questions: ExamQuestion[];
  /** preview: minutes to simulate. */
  durationMinutes?: number;
  /** live: server timestamps for the authoritative countdown. */
  expiresAtMs?: number;
  serverNowMs?: number;
  initialAnswers?: Record<string, AnswerState>;
  /** live callbacks; the harness in the attempt page owns persistence. */
  onAnswer?: (qvId: string, state: AnswerState) => void;
  onSubmit?: () => Promise<void> | void;
  /** e.g. "Saved", "Saving…", "Offline — 3 unsaved" */
  saveStatus?: string;
  /** auto-submit driven by the page (live) fires this when the clock hits 0 */
  onExpired?: () => void;
};

function formatClock(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function ExamPlayer({
  mode,
  title,
  questions,
  durationMinutes,
  expiresAtMs,
  serverNowMs,
  initialAnswers,
  onAnswer,
  onSubmit,
  saveStatus,
  onExpired,
}: ExamPlayerProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(
    initialAnswers ?? {}
  );
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // clock: preview simulates from mount; live uses server skew.
  // Computed once via useState's lazy initializer (React's sanctioned
  // run-once-at-mount hook) rather than by mutating refs during render —
  // refs are then just seeded from that single computation for the
  // interval callback below to read imperatively.
  const [clock] = useState(() => {
    if (mode === "live" && expiresAtMs && serverNowMs) {
      return { skew: serverNowMs - Date.now(), end: expiresAtMs };
    }
    return { skew: 0, end: Date.now() + (durationMinutes ?? 60) * 60_000 };
  });
  const skewRef = useRef(clock.skew);
  const endRef = useRef(clock.end);
  const [msLeft, setMsLeft] = useState(() =>
    msRemainingFromServerClock(clock.end, clock.skew + Date.now(), Date.now())
  );
  const expiredFired = useRef(false);

  const syncDisplayFromClock = useCallback(() => {
    const left = msRemainingFromServerClock(
      endRef.current,
      skewRef.current + Date.now(),
      Date.now()
    );
    setMsLeft(left);
    if (left <= 0 && !expiredFired.current) {
      expiredFired.current = true;
      onExpired?.();
    }
  }, [onExpired]);

  // Re-derive skew when server_now arrives. Skew correction alone never
  // extends the deadline — endRef moves earlier-only via expiresAtMs below.
  const lastAppliedServerNowMs = useRef(serverNowMs);
  useEffect(() => {
    if (mode !== "live" || !serverNowMs) return;
    if (serverNowMs === lastAppliedServerNowMs.current) return;
    lastAppliedServerNowMs.current = serverNowMs;
    skewRef.current = serverNowMs - Date.now();
    syncDisplayFromClock();
  }, [mode, serverNowMs, syncDisplayFromClock]);

  // Accept an earlier server expires_at immediately; ignore later values.
  useEffect(() => {
    if (mode !== "live" || expiresAtMs == null) return;
    const next = applyServerExpiresAt(endRef.current, expiresAtMs);
    if (next === endRef.current) return;
    endRef.current = next;
    syncDisplayFromClock();
  }, [mode, expiresAtMs, syncDisplayFromClock]);

  useEffect(() => {
    const t = setInterval(() => syncDisplayFromClock(), 500);
    return () => clearInterval(t);
  }, [syncDisplayFromClock]);

  const current = questions[index];
  const answeredCount = useMemo(
    () =>
      questions.filter((q) => answers[q.question_version_id]?.selected_key)
        .length,
    [questions, answers]
  );

  if (!current) {
    return <p className="text-muted-foreground">This test has no questions.</p>;
  }

  const currentOptions = examOptionsFromRpc(current.options);

  const state: AnswerState = answers[current.question_version_id] ?? {
    selected_key: null,
    marked_for_review: false,
  };

  function update(qvId: string, next: AnswerState) {
    setAnswers((a) => ({ ...a, [qvId]: next }));
    onAnswer?.(qvId, next);
  }

  async function submit() {
    setConfirmSubmit(false);
    setSubmitting(true);
    try {
      await onSubmit?.();
    } finally {
      setSubmitting(false);
    }
  }

  const low = msLeft < 5 * 60_000;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      {/* main */}
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              Question {index + 1} of {questions.length} · {answeredCount} answered
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus && (
              <span data-testid="save-status" className="text-xs text-muted-foreground">
                {saveStatus}
              </span>
            )}
            <span
              className={`rounded-md px-2 py-1 font-mono text-lg font-semibold ${
                low ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted"
              }`}
              aria-label="time remaining"
            >
              {formatClock(msLeft)}
            </span>
          </div>
        </div>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="whitespace-pre-wrap text-base leading-relaxed">
              <span className="mr-2 font-semibold">{index + 1}.</span>
              {current.stem}
            </p>
            <div className="grid gap-2">
              {currentOptions.map((o) => {
                const selected = state.selected_key === o.key;
                return (
                  <button
                    key={o.key}
                    data-testid={`option-${o.key}`}
                    aria-pressed={selected}
                    onClick={() =>
                      update(current.question_version_id, {
                        ...state,
                        selected_key: selected ? null : o.key,
                      })
                    }
                    className={`rounded-md border p-3 text-left text-sm transition-colors ${
                      selected
                        ? "border-primary bg-accent font-medium"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <span className="mr-2 font-semibold">{o.key}.</span>
                    {o.text}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Click a selected option again to clear it.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            ← Previous
          </Button>
          <Button
            variant="outline"
            disabled={index === questions.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            Next →
          </Button>
          <Button
            variant={state.marked_for_review ? "default" : "outline"}
            onClick={() =>
              update(current.question_version_id, {
                ...state,
                marked_for_review: !state.marked_for_review,
              })
            }
          >
            {state.marked_for_review ? "★ Marked" : "☆ Mark for review"}
          </Button>
          <div className="flex-1" />
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={() => setConfirmSubmit(true)}
          >
            {submitting ? "Submitting…" : "Submit exam"}
          </Button>
        </div>
      </div>

      {/* palette */}
      <div className="order-first rounded-md border p-3 lg:order-none">
        <p className="mb-2 text-sm font-medium">Questions</p>
        <div className="grid grid-cols-8 gap-1 sm:grid-cols-10 lg:grid-cols-5">
          {questions.map((q, i) => {
            const a = answers[q.question_version_id];
            const isCurrent = i === index;
            return (
              <button
                key={q.question_version_id}
                onClick={() => setIndex(i)}
                className={`flex h-8 items-center justify-center rounded text-xs font-medium transition-colors ${
                  isCurrent
                    ? "ring-2 ring-primary"
                    : ""
                } ${
                  a?.marked_for_review
                    ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
                    : a?.selected_key
                      ? "bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100"
                      : "bg-muted text-muted-foreground"
                }`}
                aria-label={`Question ${i + 1}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
          <span><span className="mr-1 inline-block h-2 w-2 rounded bg-green-300" /> answered</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded bg-amber-300" /> marked for review</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded bg-muted-foreground/30" /> unanswered</span>
        </div>
      </div>

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit the exam?</DialogTitle>
            <DialogDescription>
              You have answered {answeredCount} of {questions.length} questions.
              {answeredCount < questions.length &&
                ` ${questions.length - answeredCount} are blank.`}{" "}
              {mode === "preview"
                ? "This is a preview — nothing is recorded."
                : "You cannot change answers after submitting."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSubmit(false)}>
              Keep answering
            </Button>
            <Button variant="destructive" onClick={submit}>
              Submit now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
