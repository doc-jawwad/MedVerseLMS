"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { openPearl } from "@/lib/actions/pearls";
import { studyErrorMessage } from "@/lib/study/errors";
import { orderPearlIds, pearlProgress } from "@/lib/study/pearl-order";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResourceLockNotice } from "@/components/subscription/resource-lock-notice";

export type PearlCatalogItem = {
  id: string;
  prompt: string;
  year_id: string;
  subject_id: string;
  chapter_id: string | null;
  topic_id: string | null;
  accessible: boolean;
  subject_name?: string | null;
};

export function PearlPlayer({
  items,
  subjects,
}: {
  items: PearlCatalogItem[];
  subjects: { id: string; name: string }[];
}) {
  const [subjectId, setSubjectId] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [payload, setPayload] = useState<{
    answer: string;
    explanation: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () => (subjectId ? items.filter((p) => p.subject_id === subjectId) : items),
    [items, subjectId]
  );
  const order = useMemo(
    () => orderPearlIds(filtered.map((p) => p.id), shuffle),
    [filtered, shuffle]
  );
  const currentId = order[index] ?? null;
  const current = filtered.find((p) => p.id === currentId) ?? null;

  function go(next: number) {
    setIndex(Math.max(0, Math.min(next, Math.max(order.length - 1, 0))));
    setRevealed(false);
    setPayload(null);
  }

  function reveal() {
    if (!current?.accessible) return;
    startTransition(async () => {
      const result = await openPearl(current.id);
      if ("error" in result && result.error) {
        toast.error(studyErrorMessage(result.error));
        return;
      }
      const pearl = "pearl" in result ? result.pearl : null;
      setPayload({
        answer: String(pearl?.answer ?? ""),
        explanation: String(pearl?.explanation ?? ""),
      });
      setRevealed(true);
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Subject</span>
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setIndex(0);
              setRevealed(false);
              setPayload(null);
            }}
          >
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant={shuffle ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setShuffle((v) => !v);
            setIndex(0);
            setRevealed(false);
            setPayload(null);
          }}
        >
          {shuffle ? "Shuffled" : "Shuffle"}
        </Button>
      </div>

      {filtered.length === 0 || !current ? (
        <p className="text-sm text-muted-foreground">No pearl points match this filter.</p>
      ) : (
        <Card className="shadow-none" data-testid="pearl-card">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base text-[#072855]">Pearl Point</CardTitle>
              <Badge variant="outline">{pearlProgress(index, order.length)}</Badge>
            </div>
            {current.subject_name && (
              <p className="text-xs text-muted-foreground">{current.subject_name}</p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-lg leading-relaxed font-medium text-[#072855]">
              {current.prompt}
            </p>
            {!current.accessible && <ResourceLockNotice />}
            {current.accessible && revealed && payload && (
              <div className="rounded-xl bg-[#072855]/5 p-4" data-testid="pearl-answer">
                <p className="text-sm font-semibold tracking-wide text-[#05AEA9] uppercase">
                  Answer
                </p>
                <p className="mt-1 text-base font-medium">{payload.answer}</p>
                {payload.explanation ? (
                  <p className="mt-2 text-sm text-muted-foreground">{payload.explanation}</p>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                Previous
              </Button>
              {current.accessible && !revealed && (
                <Button
                  type="button"
                  data-testid="pearl-reveal"
                  disabled={pending}
                  onClick={reveal}
                >
                  {pending ? "Loading…" : "Reveal Answer"}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={index >= order.length - 1}
                onClick={() => go(index + 1)}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
