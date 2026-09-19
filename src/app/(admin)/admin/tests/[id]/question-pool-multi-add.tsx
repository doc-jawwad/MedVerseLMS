"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addQuestionsToTest } from "@/lib/actions/tests";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type PoolItem = {
  id: string;
  difficulty: string;
  stem: string | null;
  subject: string | null;
};

export function QuestionPoolMultiAdd({
  testId,
  pool,
}: {
  testId: string;
  pool: PoolItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function addSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await addQuestionsToTest(testId, ids);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.added !== undefined ? `Added (${res.added})` : "Added"
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} selected`
            : "Tick questions to add"}
        </p>
        <Button
          size="sm"
          disabled={pending || selected.size === 0}
          data-testid="add-selected-questions"
          onClick={addSelected}
        >
          Add selected
        </Button>
      </div>
      <div className="grid gap-1">
        {pool.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-3 rounded-md border p-2 text-sm"
          >
            <Checkbox
              checked={selected.has(p.id)}
              disabled={pending}
              data-testid={`tick-question-${p.id}`}
              onCheckedChange={(c) => toggle(p.id, c === true)}
            />
            <div className="min-w-0 flex-1 truncate">
              {p.stem}
              <span className="ml-2 text-xs text-muted-foreground">
                {p.subject} · {p.difficulty}
              </span>
            </div>
          </label>
        ))}
        {pool.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No more approved questions match this filter.
          </p>
        )}
      </div>
    </div>
  );
}
