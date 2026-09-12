"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/exam/device";
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
  // useState's lazy initializer — guaranteed to run exactly once per mount,
  // unlike useRef(createClient()).current which constructs (and discards) a
  // new client on every render.
  const [supabase] = useState(() => createClient());
  const [payload, setPayload] = useState<StartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabBlocked, setTabBlocked] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");

  // --- autosave queue ---
  const pendingRef = useRef(new Map<string, PendingSave>());
  const seqRef = useRef(1);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string>("");

  // `flush` retries itself (via setTimeout) on failure. Referencing `flush`
  // by name inside its own body is a real temporal-dead-zone hazard for
  // static analysis (and stale-closure risk if its deps ever changed), so
  // the recursive calls go through a ref that's populated post-render in an
  // effect below — same timing/semantics as before, no self-reference.
  const flushRef = useRef<() => void>(() => {});

  const flush = useCallback(async () => {
    if (flushingRef.current || !attemptIdRef.current) return;
    const entries = [...pendingRef.current.entries()];
    if (entries.length === 0) return;
    flushingRef.current = true;
    setSaveStatus("Saving…");
    let failed = 0;
    for (const [qvId, save] of entries) {
      const { error } = await supabase.rpc("save_answer", {
        p_attempt_id: attemptIdRef.current,
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
          pendingRef.current.clear();
          failed = 0;
          break;
        }
        failed++;
      } else {
        // drop only if unchanged since we started sending it
        const current = pendingRef.current.get(qvId);
        if (current && current.seq === save.seq) pendingRef.current.delete(qvId);
      }
    }
    flushingRef.current = false;
    if (failed > 0) {
      setSaveStatus(`Offline — ${pendingRef.current.size} unsaved, retrying…`);
      setTimeout(() => flushRef.current(), 4000);
    } else if (pendingRef.current.size > 0) {
      flushRef.current();
    } else {
      setSaveStatus("Saved");
    }
  }, [supabase]);

  useEffect(() => {
    flushRef.current = () => void flush();
  }, [flush]);

  const queueSave = useCallback(
    (qvId: string, state: AnswerState) => {
      pendingRef.current.set(qvId, { ...state, seq: seqRef.current++ });
      setSaveStatus("Unsaved changes…");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), 1500);
    },
    [flush]
  );

  // flush on tab hide / reconnect
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onVis);
    };
  }, [flush]);

  // warn before leaving with unsaved answers
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // --- same-device tab coordination (docs/exam-state-machine.md) ---
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
      active = true; // nobody objected: this tab owns the exam
    }, 600);
    return () => {
      clearTimeout(t);
      bc.close();
    };
  }, [testId]);

  // --- start / resume ---
  useEffect(() => {
    deviceIdRef.current = getDeviceId();
    void (async () => {
      const { data, error } = await supabase.rpc("start_attempt", {
        p_test_id: testId,
        p_device_id: deviceIdRef.current,
      });
      if (error) {
        const key = Object.keys(ERROR_COPY).find((k) => error.message.includes(k));
        if (key === "already_submitted") {
          router.replace(`/tests/${testId}/result`);
          return;
        }
        setError(key ?? error.message);
        return;
      }
      const p = data as StartPayload;
      attemptIdRef.current = p.attempt_id;
      // resume any greater save_seq the server has seen
      const maxSeq = Math.max(0, ...p.answers.map((a) => a.save_seq));
      seqRef.current = maxSeq + 1;
      setPayload(p);
    })();
  }, [supabase, testId, router]);

  // Same ref-forwarding treatment as `flush` above — `submit` retries itself
  // on failure via setTimeout.
  const submitRef = useRef<() => void>(() => {});

  const submit = useCallback(async () => {
    if (!attemptIdRef.current) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    await flush();
    const { error } = await supabase.rpc("submit_attempt", {
      p_attempt_id: attemptIdRef.current,
      p_device_id: deviceIdRef.current,
    });
    if (error && !error.message.includes("already")) {
      setSaveStatus("Submit failed — retrying…");
      setTimeout(() => submitRef.current(), 3000);
      return;
    }
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
    const copy = ERROR_COPY[error] ?? { title: "Cannot start exam", body: error };
    return <Blocker title={copy.title} body={copy.body} />;
  }
  if (!payload) {
    return <p className="text-muted-foreground">Preparing your exam…</p>;
  }

  const initialAnswers: Record<string, AnswerState> = {};
  for (const a of payload.answers) {
    initialAnswers[a.question_version_id] = {
      selected_key: a.selected_key,
      marked_for_review: a.marked_for_review,
    };
  }

  return (
    <ExamPlayer
      mode="live"
      title={payload.test_title}
      questions={payload.questions}
      expiresAtMs={new Date(payload.expires_at).getTime()}
      serverNowMs={new Date(payload.server_now).getTime()}
      initialAnswers={initialAnswers}
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
