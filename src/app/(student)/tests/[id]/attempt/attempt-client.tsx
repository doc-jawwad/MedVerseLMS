"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/exam/device";
import { applyServerExpiresAtIso } from "@/lib/exam/timer-deadline";
import { examOptionsFromRpc } from "@/lib/exam/question-options";
import { startAttemptMeansAlreadySubmitted } from "@/lib/exam/start-attempt-result";
import {
  clearAttemptDraft,
  loadAttemptDraft,
  maxSeqAmong,
  mergeServerAndLocalAnswers,
  persistDraftAck,
  persistDraftAnswer,
  type ServerAnswerRow,
} from "@/lib/exam/attempt-draft";
import {
  ExamPlayer,
  type AnswerState,
  type ExamQuestion,
} from "@/components/exam/exam-player";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StartPayload = {
  attempt_id: string;
  started_at: string;
  expires_at: string;
  server_now: string;
  test_title: string;
  questions: (ExamQuestion & { idx: number })[];
  answers: {
    question_version_id: string;
    selected_key: string | null;
    marked_for_review: boolean;
    save_seq: number;
  }[];
};

type PendingSave = AnswerState & { seq: number };

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  attempt_locked_other_device: {
    title: "Exam open on another device",
    body: "This attempt was started on a different device and is locked to it. Continue there, or ask your admin to reset the attempt.",
  },
  already_submitted: {
    title: "Already submitted",
    body: "You have already completed this test.",
  },
  test_window_closed: {
    title: "Test not open",
    body: "This test is not currently open.",
  },
  test_access_denied: {
    title: "No access",
    body: "You don't have access to this test.",
  },
  session_superseded: {
    title: "Signed in elsewhere",
    body: "Your account was signed in on another device. Sign in again to continue.",
  },
};

export function AttemptClient({ testId }: { testId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [payload, setPayload] = useState<StartPayload | null>(null);
  const [mergedAnswers, setMergedAnswers] = useState<
    Record<string, AnswerState> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [tabBlocked, setTabBlocked] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");
  // Latest server clock + expires_at for display-only timer sync (8J-D).
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);
  const [expiresAtIso, setExpiresAtIso] = useState<string | null>(null);
  const onServerTime = useCallback((iso: string) => setServerNowIso(iso), []);
  const onServerExpiresAt = useCallback((iso: string | undefined) => {
    if (!iso) return;
    setExpiresAtIso((prev) => applyServerExpiresAtIso(prev, iso));
  }, []);

  // --- autosave queue ---
  const pendingRef = useRef(new Map<string, PendingSave>());
  const seqRef = useRef(1);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string>("");
  const flushRef = useRef<() => void>(() => {});
  const flushPromiseRef = useRef<Promise<void> | null>(null);

  const flush = useCallback((): Promise<void> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    const run = (async () => {
      if (!attemptIdRef.current) return;
      const attemptId = attemptIdRef.current;
      const entries = [...pendingRef.current.entries()];
      if (entries.length === 0) return;
      setSaveStatus("Saving…");
      let failed = 0;
      let terminal = false;
      await Promise.all(
        entries.map(async ([qvId, save]) => {
          const { data, error } = await supabase.rpc("save_answer", {
            p_attempt_id: attemptId,
            p_question_version_id: qvId,
            p_selected_key: save.selected_key,
            p_marked_for_review: save.marked_for_review,
            p_save_seq: save.seq,
            p_device_id: deviceIdRef.current,
          });
          if (error) {
            if (
              error.message.includes("attempt_finalized") ||
              error.message.includes("attempt_expired")
            ) {
              terminal = true;
            } else {
              failed++;
            }
          } else {
            const current = pendingRef.current.get(qvId);
            if (current && current.seq === save.seq) {
              pendingRef.current.delete(qvId);
            }
            // Server ACK: drop matching (or older) local draft entry.
            persistDraftAck(attemptId, qvId, save.seq);
            const timing = data as {
              server_now?: string;
              expires_at?: string;
            } | null;
            if (timing?.server_now) onServerTime(timing.server_now);
            if (timing?.expires_at) onServerExpiresAt(timing.expires_at);
          }
        })
      );
      if (terminal) {
        pendingRef.current.clear();
        clearAttemptDraft(attemptId);
        failed = 0;
      }
      if (failed > 0) {
        setSaveStatus(`Offline — ${pendingRef.current.size} unsaved, retrying…`);
        setTimeout(() => flushRef.current(), 4000);
      } else if (pendingRef.current.size > 0) {
        flushRef.current();
      } else {
        setSaveStatus("Saved");
      }
    })();
    flushPromiseRef.current = run.finally(() => {
      flushPromiseRef.current = null;
    });
    return flushPromiseRef.current;
  }, [supabase, onServerTime, onServerExpiresAt]);

  useEffect(() => {
    flushRef.current = () => void flush();
  }, [flush]);

  const queueSave = useCallback(
    (qvId: string, state: AnswerState) => {
      const attemptId = attemptIdRef.current;
      if (!attemptId) return;
      const seq = seqRef.current++;
      pendingRef.current.set(qvId, { ...state, seq });
      // Durable draft immediately so a kill mid-debounce still recovers.
      persistDraftAnswer(attemptId, {
        question_version_id: qvId,
        selected_key: state.selected_key,
        marked_for_review: state.marked_for_review,
        seq,
      });
      setSaveStatus("Unsaved changes…");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), 1500);
    },
    [flush]
  );

  const resyncClock = useCallback(async () => {
    if (!attemptIdRef.current || !deviceIdRef.current) return;
    const { data, error } = await supabase.rpc("start_attempt", {
      p_test_id: testId,
      p_device_id: deviceIdRef.current,
    });
    if (startAttemptMeansAlreadySubmitted(error?.message, data)) {
      router.replace(`/tests/${testId}/result`);
      return;
    }
    if (!error) {
      const timing = data as { server_now?: string; expires_at?: string } | null;
      if (timing?.server_now) setServerNowIso(timing.server_now);
      if (timing?.expires_at) onServerExpiresAt(timing.expires_at);
    }
  }, [router, supabase, testId, onServerExpiresAt]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      } else {
        void resyncClock();
      }
    };
    const onOnline = () => {
      void flush();
      void resyncClock();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onVis);
    };
  }, [flush, resyncClock]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const bc = new BroadcastChannel(`medverse-exam-${testId}`);
    const myId = crypto.randomUUID();
    let active = false;
    bc.onmessage = (e) => {
      if (e.data?.type === "hello" && active) {
        bc.postMessage({ type: "occupied", to: e.data.id });
      }
      if (e.data?.type === "occupied" && e.data.to === myId && !active) {
        setTabBlocked(true);
      }
    };
    bc.postMessage({ type: "hello", id: myId });
    const t = setTimeout(() => {
      active = true;
    }, 600);
    return () => {
      clearTimeout(t);
      bc.close();
    };
  }, [testId]);

  // --- start / resume + local draft reconciliation (8J-E) ---
  useEffect(() => {
    deviceIdRef.current = getDeviceId();
    void (async () => {
      const { data, error } = await supabase.rpc("start_attempt", {
        p_test_id: testId,
        p_device_id: deviceIdRef.current,
      });
      if (startAttemptMeansAlreadySubmitted(error?.message, data)) {
        router.replace(`/tests/${testId}/result`);
        return;
      }
      if (error) {
        const key = Object.keys(ERROR_COPY).find((k) =>
          error.message.includes(k)
        );
        // Never surface raw Auth/DB text — only known RPC codes or a generic key.
        setError(key ?? "unknown");
        return;
      }
      const p = data as StartPayload;
      attemptIdRef.current = p.attempt_id;
      p.questions = p.questions.map((q) => ({
        ...q,
        options: examOptionsFromRpc(q.options),
      }));

      const serverRows: ServerAnswerRow[] = p.answers.map((a) => ({
        question_version_id: a.question_version_id,
        selected_key: a.selected_key,
        marked_for_review: a.marked_for_review,
        save_seq: a.save_seq,
      }));
      const localDraft = loadAttemptDraft(p.attempt_id);
      const merged = mergeServerAndLocalAnswers(serverRows, localDraft);
      seqRef.current = maxSeqAmong(serverRows, localDraft) + 1;

      const initial: Record<string, AnswerState> = {};
      for (const row of merged) {
        initial[row.question_version_id] = {
          selected_key: row.selected_key,
          marked_for_review: row.marked_for_review,
        };
        if (row.needsFlush) {
          pendingRef.current.set(row.question_version_id, {
            selected_key: row.selected_key,
            marked_for_review: row.marked_for_review,
            seq: row.seq,
          });
        }
      }

      setServerNowIso(p.server_now);
      setExpiresAtIso(p.expires_at);
      setMergedAnswers(initial);
      setPayload(p);

      if (pendingRef.current.size > 0) {
        setSaveStatus("Restoring unsaved answers…");
        void flushRef.current();
      }
    })();
  }, [supabase, testId, router]);

  useEffect(() => {
    if (!payload) return;
    const interval = setInterval(() => void resyncClock(), 3 * 60_000);
    return () => clearInterval(interval);
  }, [payload, resyncClock]);

  const submitRef = useRef<() => void>(() => {});

  const submit = useCallback(async () => {
    if (!attemptIdRef.current) return;
    const attemptId = attemptIdRef.current;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    await flush();
    const { error } = await supabase.rpc("submit_attempt", {
      p_attempt_id: attemptId,
      p_device_id: deviceIdRef.current,
    });
    if (error && !error.message.includes("already")) {
      setSaveStatus("Submit failed — retrying…");
      setTimeout(() => submitRef.current(), 3000);
      return;
    }
    clearAttemptDraft(attemptId);
    router.replace(`/tests/${testId}/result`);
  }, [flush, supabase, router, testId]);

  useEffect(() => {
    submitRef.current = () => void submit();
  }, [submit]);

  if (tabBlocked) {
    return (
      <Blocker
        title="Exam already open in another tab"
        body="Continue in the tab where the exam is running. Close this tab."
      />
    );
  }
  if (error) {
    const copy = ERROR_COPY[error] ?? {
      title: "Cannot start exam",
      body: "Something went wrong. Please try again.",
    };
    return <Blocker title={copy.title} body={copy.body} />;
  }
  if (!payload || !mergedAnswers) {
    return <p className="text-muted-foreground">Preparing your exam…</p>;
  }

  return (
    <ExamPlayer
      mode="live"
      title={payload.test_title}
      questions={payload.questions}
      expiresAtMs={new Date(expiresAtIso ?? payload.expires_at).getTime()}
      serverNowMs={new Date(serverNowIso ?? payload.server_now).getTime()}
      initialAnswers={mergedAnswers}
      saveStatus={saveStatus}
      onAnswer={queueSave}
      onSubmit={submit}
      onExpired={submit}
    />
  );
}

function Blocker({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/tests">Back to tests</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
