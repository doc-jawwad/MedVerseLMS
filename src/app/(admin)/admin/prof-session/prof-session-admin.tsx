"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  createProfSessionDay,
  reorderProfSessionDays,
  softDeleteProfSessionDay,
  updateProfSessionDay,
} from "@/lib/actions/prof-session";
import {
  ConfirmDangerDialog,
  purgeDateHint,
} from "@/components/admin/confirm-danger-dialog";

export type ProfSessionDayRow = {
  id: string;
  name: string;
  sort_order: number;
  status: "draft" | "published";
  subject_id: string;
};

export type ProfSessionSubjectOption = {
  id: string;
  name: string;
  product_key: string;
};

export function ProfSessionAdmin({
  yearId,
  yearLabel,
  subjects,
  selectedSubject,
  days: initialDays,
}: {
  yearId: string;
  yearLabel: string;
  subjects: ProfSessionSubjectOption[];
  selectedSubject: ProfSessionSubjectOption | null;
  days: ProfSessionDayRow[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const sorted = useMemo(
    () =>
      [...days].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [days]
  );

  function refresh() {
    router.refresh();
  }

  if (!selectedSubject) {
    return (
      <div className="grid gap-2">
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Prof. Session
        </h1>
        <p className="text-sm text-muted-foreground">
          Select a class with product Blocks to manage subject-scoped days.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {yearLabel} · {selectedSubject.name}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
          Prof. Session days
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Days belong to this product subject. Students see published days when
          subscribed. Slots: Guidelines · LoS · Practice MCQs · Test MCQs ·
          One-Liners. Materials and one-liners are managed in Library / One-liners
          with day links.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/admin/library?year=${yearId}`}
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            Materials
          </Link>
          <Link
            href="/admin/one-liners"
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            One-liners
          </Link>
          <Link
            href="/admin/questions"
            className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
          >
            Questions
          </Link>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const { error, id } = await createProfSessionDay(
              selectedSubject.id,
              name
            );
            if (error) {
              toast.error(error);
              return;
            }
            toast.success("Day created (draft)");
            setName("");
            if (id) {
              setDays((prev) => [
                ...prev,
                {
                  id,
                  name: name.trim(),
                  sort_order: prev.length + 1,
                  status: "draft",
                  subject_id: selectedSubject.id,
                },
              ]);
            }
            refresh();
          });
        }}
      >
        <div className="grid min-w-[14rem] flex-1 gap-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="day-name"
          >
            New day name
          </label>
          <Input
            id="day-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Day 1 — Foundations"
            disabled={pending}
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          Create day
        </Button>
      </form>

      {subjects.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          Switch subjects with the links above. Reorder applies within{" "}
          {selectedSubject.name} only.
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No days yet for {selectedSubject.name}. Create a day to publish Prof.
          Session MCQ Bank content for this subject.
        </p>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((day, index) => (
            <li
              key={day.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-sm font-medium"
                    defaultValue={day.name}
                    disabled={pending}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === day.name) return;
                      startTransition(async () => {
                        const { error } = await updateProfSessionDay({
                          dayId: day.id,
                          name: next,
                        });
                        if (error) toast.error(error);
                        else {
                          setDays((prev) =>
                            prev.map((d) =>
                              d.id === day.id ? { ...d, name: next } : d
                            )
                          );
                          toast.success("Renamed");
                          refresh();
                        }
                      });
                    }}
                  />
                  <Badge
                    variant={day.status === "published" ? "default" : "outline"}
                  >
                    {day.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Slots: Guidelines · LoS · Practice MCQs · Test MCQs · One-Liners
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" size="sm" variant="secondary">
                  <Link href={`/admin/prof-session/${day.id}`}>
                    Manage day content
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || index === 0}
                  onClick={() =>
                    startTransition(async () => {
                      const ids = sorted.map((d) => d.id);
                      const next = [...ids];
                      [next[index - 1], next[index]] = [
                        next[index]!,
                        next[index - 1]!,
                      ];
                      const { error } = await reorderProfSessionDays(
                        selectedSubject.id,
                        next
                      );
                      if (error) toast.error(error);
                      else {
                        toast.success("Reordered");
                        refresh();
                      }
                    })
                  }
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const nextStatus =
                        day.status === "published" ? "draft" : "published";
                      const { error } = await updateProfSessionDay({
                        dayId: day.id,
                        status: nextStatus,
                      });
                      if (error) toast.error(error);
                      else {
                        setDays((prev) =>
                          prev.map((d) =>
                            d.id === day.id ? { ...d, status: nextStatus } : d
                          )
                        );
                        toast.success(
                          nextStatus === "published"
                            ? "Published"
                            : "Unpublished"
                        );
                        refresh();
                      }
                    })
                  }
                >
                  {day.status === "published" ? "Unpublish" : "Publish"}
                </Button>
                <ConfirmDangerDialog
                  title="Move day to Bin?"
                  description={
                    <>
                      <p>
                        “{day.name}” will be hidden from students and normal
                        admin lists. It stays in the Bin until about{" "}
                        <strong>{purgeDateHint()}</strong>, then can be
                        permanently purged.
                      </p>
                      <p className="mt-2">This is not a permanent delete.</p>
                    </>
                  }
                  confirmLabel="Move to Bin"
                  trigger={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  }
                  onConfirm={() => softDeleteProfSessionDay(day.id)}
                  onSuccess={() => {
                    setDays((prev) => prev.filter((d) => d.id !== day.id));
                    refresh();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
