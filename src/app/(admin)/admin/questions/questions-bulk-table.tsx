"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  bulkMoveQuestionsToBin,
  listQuestionUsages,
  type BulkSoftDeleteResult,
} from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type QuestionRow = {
  id: string;
  status: string;
  difficulty: string | null;
  used_in_test: boolean | null;
  subjects: { name: string } | null;
  chapters: { name: string } | null;
  topics: { name: string } | null;
  question_versions: { stem: string; version_no: number } | null;
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  draft: "secondary",
  review: "outline",
  needs_revision: "destructive",
  archived: "outline",
};

export function QuestionsBulkTable({ questions }: { questions: QuestionRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allIds = questions.map((q) => q.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkBin() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const usageResults = await Promise.all(
        ids.map(async (id) => {
          const res = await listQuestionUsages(id);
          return { id, usages: res.usages ?? [] };
        })
      );
      const withUsages = usageResults.filter((r) => r.usages.length > 0);
      let msg = `Move ${ids.length} question(s) to Bin? Recoverable for ~7 days.`;
      if (withUsages.length > 0) {
        const sample = withUsages
          .slice(0, 5)
          .map((r) => {
            const labels = r.usages.map((u) => u.usage_label).join("; ");
            return `• ${labels}`;
          })
          .join("\n");
        const more =
          withUsages.length > 5
            ? `\n…and ${withUsages.length - 5} more with usages.`
            : "";
        msg = `${withUsages.length} of ${ids.length} selected question(s) are still linked elsewhere:\n${sample}${more}\n\nMove to Bin anyway?`;
      }
      if (!window.confirm(msg)) return;

      const res = await bulkMoveQuestionsToBin(ids);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const r = (res as { result: BulkSoftDeleteResult }).result;
      const parts: string[] = [];
      if (r.binned > 0) parts.push(`${r.binned} moved to Bin`);
      if (r.blocked_active_test > 0)
        parts.push(`${r.blocked_active_test} blocked (active test)`);
      if (r.not_found > 0) parts.push(`${r.not_found} not found`);
      toast.success(parts.join(" · ") || "Done");
      setSelected(new Set());
    });
  }

  return (
    <div className="grid gap-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/60 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={bulkBin}
          >
            {pending ? "Checking…" : "Move to Bin"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  disabled={pending}
                />
              </TableHead>
              <TableHead className="min-w-[12rem] max-w-md">Question</TableHead>
              <TableHead className="hidden sm:table-cell">Subject</TableHead>
              <TableHead className="hidden md:table-cell">Chapter / Topic</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Ver.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No questions match.
                </TableCell>
              </TableRow>
            )}
            {questions.map((q) => {
              const v = q.question_versions;
              const subj = q.subjects;
              const chap = q.chapters;
              const top = q.topics;
              return (
                <TableRow
                  key={q.id}
                  className={selected.has(q.id) ? "bg-muted/30" : ""}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(q.id)}
                      onCheckedChange={() => toggleOne(q.id)}
                      aria-label="Select question"
                      disabled={pending}
                    />
                  </TableCell>
                  <TableCell className="max-w-md">
                    <Link
                      href={`/admin/questions/${q.id}`}
                      className="line-clamp-2 hover:underline"
                    >
                      {v?.stem ?? "(no version)"}
                    </Link>
                    {q.used_in_test && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        used in test
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {subj?.name}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {chap?.name} / {top?.name}
                  </TableCell>
                  <TableCell>{q.difficulty}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[q.status] ?? "outline"}>
                      {q.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    v{v?.version_no ?? "?"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
