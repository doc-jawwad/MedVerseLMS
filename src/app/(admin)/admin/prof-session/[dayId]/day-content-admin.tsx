"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addProfSessionDayFolder,
  setDayPracticeQuestions,
  setOneLinerDay,
  setTestProfSessionDay,
} from "@/lib/actions/prof-session";
import { createOneLiner } from "@/lib/actions/one-liners";
import { DayPracticeCsvImport } from "./day-practice-csv-import";

export type DayQuestionOption = {
  id: string;
  difficulty: string;
  stemPreview: string;
  subjectName: string | null;
};

export type DayTestOption = {
  id: string;
  title: string;
  status: string;
  linkedToThisDay: boolean;
  linkedElsewhere: boolean;
};

export type DayOneLinerRow = {
  id: string;
  title: string;
  status: "draft" | "published";
  linkedToThisDay: boolean;
};

export type DayFolderRow = {
  id: string;
  name: string;
  slotKey: "guidelines" | "los";
  entitlement: string;
};

export type DaySubjectOption = { id: string; name: string };

type PracticeMode = "select" | "csv";

export function ProfSessionDayContentAdmin({
  dayId,
  dayName,
  dayStatus,
  yearId,
  yearLabel,
  subjectId,
  subjectName,
  linkedPracticeIds,
  questions,
  yearSubjects,
  tests,
  oneLiners,
  folders,
}: {
  dayId: string;
  dayName: string;
  dayStatus: "draft" | "published";
  yearId: string;
  yearLabel: string;
  subjectId: string;
  subjectName: string;
  linkedPracticeIds: string[];
  questions: DayQuestionOption[];
  yearSubjects: DaySubjectOption[];
  tests: DayTestOption[];
  oneLiners: DayOneLinerRow[];
  folders: DayFolderRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedPractice, setSelectedPractice] = useState<Set<string>>(
    () => new Set(linkedPracticeIds)
  );
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("select");
  const [poolFilter, setPoolFilter] = useState("");
  const [poolSelected, setPoolSelected] = useState<Set<string>>(new Set());
  const [folderName, setFolderName] = useState("");
  const [folderSlot, setFolderSlot] = useState<"guidelines" | "los">(
    "guidelines"
  );
  const [olTitle, setOlTitle] = useState("");
  const [olBody, setOlBody] = useState("");

  useEffect(() => {
    setSelectedPractice(new Set(linkedPracticeIds));
  }, [linkedPracticeIds]);

  const linkedFolders = useMemo(
    () => ({
      guidelines: folders.filter((f) => f.slotKey === "guidelines"),
      los: folders.filter((f) => f.slotKey === "los"),
    }),
    [folders]
  );

  const questionById = useMemo(() => {
    const map = new Map<string, DayQuestionOption>();
    for (const q of questions) map.set(q.id, q);
    return map;
  }, [questions]);

  const selectedList = useMemo(
    () =>
      Array.from(selectedPractice)
        .map(
          (id) =>
            questionById.get(id) ?? {
              id,
              difficulty: "?",
              stemPreview: id,
              subjectName: null,
            }
        )
        .sort((a, b) => a.stemPreview.localeCompare(b.stemPreview)),
    [selectedPractice, questionById]
  );

  const pool = useMemo(() => {
    const q = poolFilter.trim().toLowerCase();
    return questions.filter((item) => {
      if (selectedPractice.has(item.id)) return false;
      if (!q) return true;
      return (
        item.stemPreview.toLowerCase().includes(q) ||
        (item.subjectName ?? "").toLowerCase().includes(q) ||
        item.difficulty.toLowerCase().includes(q)
      );
    });
  }, [questions, selectedPractice, poolFilter]);

  function refresh() {
    router.refresh();
  }

  function savePracticeSet(ids: string[], successMsg: string) {
    startTransition(async () => {
      const { error } = await setDayPracticeQuestions(dayId, ids);
      if (error) toast.error(error);
      else {
        toast.success(successMsg);
        setSelectedPractice(new Set(ids));
        setPoolSelected(new Set());
        refresh();
      }
    });
  }

  function removeFromDay(id: string) {
    const next = Array.from(selectedPractice).filter((x) => x !== id);
    savePracticeSet(next, "Removed from this day");
  }

  function addPoolSelection() {
    if (poolSelected.size === 0) return;
    const next = Array.from(new Set([...selectedPractice, ...poolSelected]));
    savePracticeSet(next, `Added ${poolSelected.size} question(s) to this day`);
  }

  return (
    <div className="grid gap-8">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          {yearLabel} · {subjectName}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
            {dayName}
          </h1>
          <Badge variant={dayStatus === "published" ? "default" : "outline"}>
            {dayStatus}
          </Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Attach day content to existing engines — materials, practice MCQs,
          formal tests, and one-liners. No separate CMS.
        </p>
      </div>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
          Guidelines &amp; LoS folders
        </h2>
        <p className="text-sm text-muted-foreground">
          Create a day-scoped folder, then upload items in Materials admin.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Slot</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={folderSlot}
              disabled={pending}
              onChange={(e) =>
                setFolderSlot(e.target.value as "guidelines" | "los")
              }
            >
              <option value="guidelines">Guidelines</option>
              <option value="los">LoS</option>
            </select>
          </div>
          <div className="grid min-w-[14rem] flex-1 gap-1">
            <Label className="text-xs" htmlFor="folder-name">
              Folder name
            </Label>
            <Input
              id="folder-name"
              value={folderName}
              disabled={pending}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. Day guidelines"
            />
          </div>
          <Button
            type="button"
            disabled={pending || !folderName.trim()}
            onClick={() =>
              startTransition(async () => {
                const { error } = await addProfSessionDayFolder({
                  yearId,
                  subjectId,
                  dayId,
                  slotKey: folderSlot,
                  name: folderName,
                  entitlement: "any_subscription",
                });
                if (error) toast.error(error);
                else {
                  toast.success("Folder created");
                  setFolderName("");
                  refresh();
                }
              })
            }
          >
            Create folder
          </Button>
          <Button asChild type="button" variant="outline">
            <Link
              href={`/admin/materials?year=${yearId}&type=${folderSlot === "los" ? "los" : "guidelines"}`}
            >
              Open Materials
            </Link>
          </Button>
        </div>
        <ul className="grid gap-2 text-sm">
          {folders.length === 0 ? (
            <li className="text-muted-foreground">No day folders yet.</li>
          ) : (
            folders.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <span>
                  <Badge variant="outline" className="mr-2">
                    {f.slotKey === "los" ? "LoS" : "Guidelines"}
                  </Badge>
                  {f.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {f.entitlement}
                </span>
              </li>
            ))
          )}
        </ul>
        {(linkedFolders.guidelines.length > 0 ||
          linkedFolders.los.length > 0) && (
          <p className="text-xs text-muted-foreground">
            Upload files under the matching Guidelines / LoS tab in Materials
            for this class.
          </p>
        )}
      </section>

      <section
        className="grid gap-3 rounded-xl border bg-card p-4"
        data-testid="day-practice-mcqs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
            Practice MCQs
          </h2>
          <p
            className="text-sm font-medium text-[var(--student-ink)]"
            data-testid="day-practice-selected-count"
          >
            Selected: {selectedPractice.size}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Attach approved Question Bank MCQs to <strong>this day only</strong>.
          Select existing bank questions or import a CSV — no duplicate question
          architecture; other days stay isolated.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={practiceMode === "select" ? "default" : "outline"}
            data-testid="day-practice-mode-select"
            onClick={() => setPracticeMode("select")}
          >
            Select Existing MCQs
          </Button>
          <Button
            type="button"
            size="sm"
            variant={practiceMode === "csv" ? "default" : "outline"}
            data-testid="day-practice-mode-csv"
            onClick={() => setPracticeMode("csv")}
          >
            CSV Import
          </Button>
        </div>

        {selectedList.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              On this day
            </p>
            <ul className="max-h-48 overflow-y-auto grid gap-2">
              {selectedList.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2"
                  data-testid={`day-practice-selected-${q.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--student-ink)]">
                      {q.stemPreview}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[q.subjectName, q.difficulty].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={pending}
                    data-testid={`day-practice-remove-${q.id}`}
                    onClick={() => removeFromDay(q.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No practice MCQs on this day yet.
          </p>
        )}

        {practiceMode === "select" ? (
          <div className="grid gap-3 border-t pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-[14rem] flex-1 gap-1">
                <Label className="text-xs" htmlFor="pool-filter">
                  Filter pool
                </Label>
                <Input
                  id="pool-filter"
                  value={poolFilter}
                  onChange={(e) => setPoolFilter(e.target.value)}
                  placeholder="Search stem / subject…"
                  data-testid="day-practice-pool-filter"
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={pending || poolSelected.size === 0}
                data-testid="day-practice-add-selected"
                onClick={addPoolSelection}
              >
                Add selected ({poolSelected.size})
              </Button>
            </div>
            {questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No approved questions in this class yet. Author questions in the
                Question Bank for {yearLabel}, then attach them here.
              </p>
            ) : pool.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No more matching questions to add (already selected or filtered
                out).
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto grid gap-2">
                {pool.map((q) => {
                  const checked = poolSelected.has(q.id);
                  return (
                    <li
                      key={q.id}
                      className="flex items-start gap-3 rounded-lg border px-3 py-2"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={pending}
                        data-testid={`day-practice-tick-${q.id}`}
                        onCheckedChange={() =>
                          setPoolSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(q.id)) next.delete(q.id);
                            else next.add(q.id);
                            return next;
                          })
                        }
                        aria-label={`Select question ${q.id}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[var(--student-ink)]">
                          {q.stemPreview}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[q.subjectName, q.difficulty]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <DayPracticeCsvImport
            dayId={dayId}
            linkedPracticeIds={Array.from(selectedPractice)}
            subjects={yearSubjects}
            preferredSubjectId={subjectId}
            onAttached={(ids) => setSelectedPractice(new Set(ids))}
          />
        )}
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
          Test MCQs
        </h2>
        <p className="text-sm text-muted-foreground">
          Link formal tests in this class (same subject or unscoped) to this
          day.
        </p>
        {tests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tests in this class yet.{" "}
            <Link
              href={`/admin/tests?year=${yearId}`}
              className="text-[var(--brand-teal-ink)] underline-offset-4 hover:underline"
            >
              Create a test
            </Link>
          </p>
        ) : (
          <ul className="grid gap-2">
            {tests.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--student-ink)]">
                    {t.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.status}
                    {t.linkedElsewhere ? " · linked to another day" : ""}
                  </p>
                </div>
                {t.linkedToThisDay ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const { error } = await setTestProfSessionDay(
                          t.id,
                          null
                        );
                        if (error) toast.error(error);
                        else {
                          toast.success("Unlinked from day");
                          refresh();
                        }
                      })
                    }
                  >
                    Clear day link
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || t.linkedElsewhere}
                    onClick={() =>
                      startTransition(async () => {
                        const { error } = await setTestProfSessionDay(
                          t.id,
                          dayId
                        );
                        if (error) toast.error(error);
                        else {
                          toast.success("Linked to day");
                          refresh();
                        }
                      })
                    }
                  >
                    Link to day
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
          One-Liners
        </h2>
        <p className="text-sm text-muted-foreground">
          Attach one-liners from this class to this day, or create a simple one
          under {subjectName} and attach it.
        </p>
        <form
          className="grid gap-2 rounded-lg border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const created = await createOneLiner({
                year_id: yearId,
                subject_id: subjectId,
                title: olTitle,
                body: olBody,
                status: "published",
              });
              if ("error" in created && created.error) {
                toast.error(created.error);
                return;
              }
              const id = "id" in created ? created.id : null;
              if (!id) {
                toast.error("Could not create one-liner.");
                return;
              }
              const { error } = await setOneLinerDay(id, dayId);
              if (error) toast.error(error);
              else {
                toast.success("One-liner created and attached");
                setOlTitle("");
                setOlBody("");
                refresh();
              }
            });
          }}
        >
          <Label htmlFor="ol-title">New one-liner title</Label>
          <Input
            id="ol-title"
            value={olTitle}
            disabled={pending}
            onChange={(e) => setOlTitle(e.target.value)}
            required
          />
          <Label htmlFor="ol-body">Body</Label>
          <Textarea
            id="ol-body"
            value={olBody}
            disabled={pending}
            onChange={(e) => setOlBody(e.target.value)}
            rows={3}
          />
          <Button type="submit" disabled={pending || !olTitle.trim()}>
            Create &amp; attach
          </Button>
        </form>
        {oneLiners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one-liners in this class yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {oneLiners.map((ol) => (
              <li
                key={ol.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--student-ink)]">
                    {ol.title}
                  </p>
                  <Badge variant="outline" className="mt-1">
                    {ol.status}
                  </Badge>
                </div>
                {ol.linkedToThisDay ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const { error } = await setOneLinerDay(ol.id, null);
                        if (error) toast.error(error);
                        else {
                          toast.success("Detached from day");
                          refresh();
                        }
                      })
                    }
                  >
                    Detach
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const { error } = await setOneLinerDay(ol.id, dayId);
                        if (error) toast.error(error);
                        else {
                          toast.success("Attached to day");
                          refresh();
                        }
                      })
                    }
                  >
                    Attach
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
