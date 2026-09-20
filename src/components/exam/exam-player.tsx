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
import {
  nextAnswerState,
  nextRemainingIndex,
  questionStatus,
  skippedQuestionIndexes,
  tallyQuestionStatuses,
  type ExamQuestionStatus,
} from "@/lib/exam/question-status";
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
import { cn } from "@/lib/utils";
import { ExamPwaGuard } from "@/components/pwa/exam-pwa-guard";

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

function paletteClass(status: ExamQuestionStatus, isCurrent: boolean) {
  return cn(
    "flex h-8 items-center justify-center rounded-md text-xs font-semibold transition-colors",
    isCurrent && "ring-2 ring-[#072855] ring-offset-1",
    status === "answered" &&
      "bg-[#05AEA9]/20 text-[var(--student-ink)] dark:bg-teal-900 dark:text-teal-50",
    status === "skipped" &&
      "bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50",
    status === "remaining" && "bg-muted text-muted-foreground"
  );
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
  const scrollerRef = useRef<HTMLDivElement>(null);

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

  const lastAppliedServerNowMs = useRef(serverNowMs);
  useEffect(() => {
    if (mode !== "live" || !serverNowMs) return;
    if (serverNowMs === lastAppliedServerNowMs.current) return;
    lastAppliedServerNowMs.current = serverNowMs;
    skewRef.current = serverNowMs - Date.now();
    syncDisplayFromClock();
  }, [mode, serverNowMs, syncDisplayFromClock]);

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

  useEffect(() => {
    if (mode !== "live") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mode]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const tallies = useMemo(
    () => tallyQuestionStatuses(questions, answers),
    [questions, answers]
  );
  const skippedIndexes = useMemo(
    () => skippedQuestionIndexes(questions, answers),
    [questions, answers]
  );

  const current = questions[index];
  if (!current) {
    return <p className="text-muted-foreground">This test has no questions.</p>;
  }

  const currentOptions = examOptionsFromRpc(current.options);
  const state: AnswerState = answers[current.question_version_id] ?? {
    selected_key: null,
    marked_for_review: false,
  };
  const status = questionStatus(state);
  const low = msLeft < 5 * 60_000;
  const progressPct =
    tallies.total === 0
      ? 0
      : Math.round((tallies.answered / tallies.total) * 100);

  function update(qvId: string, next: AnswerState) {
    setAnswers((a) => ({ ...a, [qvId]: next }));
    onAnswer?.(qvId, next);
  }

  function selectKey(key: string) {
    update(
      current.question_version_id,
      nextAnswerState(state, { type: "select", key })
    );
  }

  function skipOrUnskip() {
    if (status === "answered") return;
    if (status === "skipped") {
      update(
        current.question_version_id,
        nextAnswerState(state, { type: "unskip" })
      );
      return;
    }
    const next = nextAnswerState(state, { type: "skip" });
    const nextAnswers = { ...answers, [current.question_version_id]: next };
    setAnswers(nextAnswers);
    onAnswer?.(current.question_version_id, next);
    const jump = nextRemainingIndex(questions, nextAnswers, index);
    if (jump != null) setIndex(jump);
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={index === 0}
        onClick={() => setIndex(index - 1)}
      >
        ← Previous
      </Button>
      <Button
        data-testid="skip-question"
        variant={status === "skipped" ? "secondary" : "outline"}
        disabled={status === "answered"}
        aria-pressed={status === "skipped"}
        onClick={skipOrUnskip}
      >
        {status === "skipped" ? "Unskip" : "Skip"}
      </Button>
      <Button
        variant="outline"
        disabled={index === questions.length - 1}
        onClick={() => setIndex(index + 1)}
      >
        Next →
      </Button>
      <div className="hidden flex-1 sm:block" />
      <Button
        variant="destructive"
        className="ml-auto sm:ml-0"
        disabled={submitting}
        onClick={() => setConfirmSubmit(true)}
      >
        {submitting ? "Submitting…" : "Submit exam"}
      </Button>
    </div>
  );

  const navPanel = (
    <div className="grid gap-3">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--student-ink)]/70 uppercase">
          Questions
        </p>
        <div className="grid grid-cols-8 gap-1 sm:grid-cols-10 lg:grid-cols-5">
          {questions.map((q, i) => {
            const qStatus = questionStatus(answers[q.question_version_id]);
            return (
              <button
                key={q.question_version_id}
                type="button"
                onClick={() => setIndex(i)}
                className={paletteClass(qStatus, i === index)}
                aria-label={`Question ${i + 1}${
                  qStatus === "skipped"
                    ? ", skipped"
                    : qStatus === "answered"
                      ? ", answered"
                      : ", remaining"
                }`}
                aria-current={i === index ? "true" : undefined}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-testid="skipped-list"
        className="rounded-lg border border-amber-200/80 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/40"
      >
        <p className="text-xs font-semibold tracking-wide text-amber-950 uppercase dark:text-amber-100">
          Skipped MCQs
        </p>
        {skippedIndexes.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">None skipped.</p>
        ) : (
          <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {skippedIndexes.map((i) => (
              <button
                key={questions[i]!.question_version_id}
                type="button"
                data-testid={`skipped-jump-${i + 1}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "flex h-8 min-w-8 items-center justify-center rounded-md bg-amber-200 px-2 text-xs font-semibold text-amber-950 dark:bg-amber-800 dark:text-amber-50",
                  i === index && "ring-2 ring-[#072855]"
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded bg-[#05AEA9]/50" />{" "}
          answered
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded bg-amber-300" />{" "}
          skipped
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded bg-muted-foreground/30" />{" "}
          remaining
        </span>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        mode === "live"
          ? "fixed inset-0 z-50 bg-[var(--student-canvas)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
          : "min-h-0"
      )}
    >
      {mode === "live" ? <ExamPwaGuard /> : null}
      <header className="shrink-0 border-b bg-card/90 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold text-[var(--student-ink)] sm:text-base">
              {title}
            </p>
            <p className="text-xs text-muted-foreground">
              Question {index + 1} of {questions.length}
              {mode === "preview" ? " · preview" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus && (
              <span
                data-testid="save-status"
                className="text-xs text-muted-foreground"
              >
                {saveStatus}
              </span>
            )}
            <span
              className={cn(
                "rounded-lg px-2.5 py-1 font-mono text-lg font-semibold tabular-nums",
                low
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : "bg-[#072855] text-white"
              )}
              aria-label="time remaining"
            >
              {formatClock(msLeft)}
            </span>
          </div>
        </div>
        <div
          className="mx-auto mt-3 flex w-full max-w-6xl flex-wrap items-center gap-2"
          aria-live="polite"
        >
          <CountChip
            testId="remaining-mcqs"
            label="Remaining MCQs"
            value={tallies.remaining}
            tone="muted"
          />
          <CountChip
            testId="skipped-mcqs"
            label="Skipped MCQs"
            value={tallies.skipped}
            tone="skipped"
          />
          <CountChip
            label="Answered"
            value={tallies.answered}
            tone="answered"
          />
        </div>
        <div
          className="mx-auto mt-3 h-1 w-full max-w-6xl overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[#05AEA9] transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col lg:flex-row">
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:pr-6"
        >
          <Card className="shadow-none">
            <CardContent className="grid gap-4 pt-6">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--student-ink)] sm:text-base">
                <span className="mr-2 font-semibold">{index + 1}.</span>
                {current.stem}
              </p>
              {status === "skipped" && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                  Skipped — still unanswered. Choose an option to record an
                  answer.
                </p>
              )}
              <div className="grid gap-2">
                {currentOptions.map((o) => {
                  const selected = state.selected_key === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      data-testid={`option-${o.key}`}
                      aria-pressed={selected}
                      onClick={() => selectKey(o.key)}
                      className={cn(
                        "rounded-xl border p-3.5 text-left text-sm transition-colors",
                        selected
                          ? "border-[#05AEA9] bg-[#05AEA9]/10 font-medium text-[var(--student-ink)]"
                          : "border-border bg-card hover:bg-accent/60"
                      )}
                    >
                      <span className="mr-2 font-semibold">{o.key}.</span>
                      {o.text}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Click a selected option again to clear it. Skip leaves the
                question unanswered.
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="max-h-52 shrink-0 overflow-y-auto border-t bg-card/70 px-4 py-3 lg:max-h-none lg:w-[17.5rem] lg:border-t-0 lg:border-l">
          {navPanel}
        </aside>
      </div>

      <div
        className="shrink-0 border-t bg-card px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-6xl">{actions}</div>
      </div>

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit the exam?</DialogTitle>
            <DialogDescription>
              You have answered {tallies.answered} of {tallies.total} questions.
              {tallies.skipped > 0 &&
                ` ${tallies.skipped} skipped (still unanswered).`}
              {tallies.remaining > 0 &&
                ` ${tallies.remaining} remaining unanswered.`}{" "}
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

function CountChip({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone: "muted" | "skipped" | "answered";
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-xs",
        tone === "skipped" && "bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-50",
        tone === "answered" && "bg-[#05AEA9]/15 text-[var(--student-ink)]",
        tone === "muted" && "bg-muted text-[var(--student-ink)]"
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="font-heading text-sm font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}
