"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addQuestionToTest,
  addRandomQuestions,
  removeQuestionFromTest,
  reorderQuestion,
  setQuestionMarks,
  setAudienceYears,
  publishTest,
  closeTestNow,
  invalidateTest,
  voidTestQuestion,
  type QuestionFilter,
} from "@/lib/actions/tests";
import { publishTestErrorMessage } from "@/lib/tests/publish-test-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTestDraftAudience } from "../test-draft-audience-context";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ error?: string; added?: number }>, ok?: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        if (ok) toast.success(res.added !== undefined ? `${ok} (${res.added})` : ok);
        router.refresh();
      }
    });
  return { pending, run };
}

export function AddQuestionButton({ testId, questionId }: { testId: string; questionId: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" variant="secondary" disabled={pending}
      data-testid={`add-question-${questionId}`}
      onClick={() => run(() => addQuestionToTest(testId, questionId), "Added")}>
      Add
    </Button>
  );
}

export function RemoveQuestionButton({ testId, questionId }: { testId: string; questionId: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}
      data-testid={`remove-draft-question-${questionId}`}
      onClick={() => run(() => removeQuestionFromTest(testId, questionId), "Removed")}>
      Remove
    </Button>
  );
}

// Manual reorder — only rendered for draft tests (position is frozen and
// immutable once published, same as everywhere else in this file).
export function MoveQuestionButtons({
  testId,
  questionId,
  isFirst,
  isLast,
}: {
  testId: string;
  questionId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={pending || isFirst} aria-label="Move up"
        data-testid={`move-up-${questionId}`}
        onClick={() => run(() => reorderQuestion(testId, questionId, "up"))}>
        ↑
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || isLast} aria-label="Move down"
        data-testid={`move-down-${questionId}`}
        onClick={() => run(() => reorderQuestion(testId, questionId, "down"))}>
        ↓
      </Button>
    </div>
  );
}

// Per-question marks override — blank uses the test's default
// marks_per_question (score_attempt already does
// coalesce(tq.marks, t.marks_per_question); this just exposes it).
export function QuestionMarksInput({
  testId,
  questionId,
  marks,
  defaultMarks,
}: {
  testId: string;
  questionId: string;
  marks: number | null;
  defaultMarks: number;
}) {
  const { pending, run } = useAction();
  const [value, setValue] = useState(marks !== null ? String(marks) : "");

  function save() {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !(parsed > 0)) {
      setValue(marks !== null ? String(marks) : "");
      return;
    }
    run(() => setQuestionMarks(testId, questionId, parsed));
  }

  return (
    <Input
      type="number"
      min={0.01}
      step={0.25}
      placeholder={String(defaultMarks)}
      value={value}
      disabled={pending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      className="h-8 w-20"
      title="Marks for this question (blank = test default)"
      aria-label="Marks for this question"
      data-testid={`marks-input-${questionId}`}
    />
  );
}

// All filter changes (including cascading book/chapter/topic and MCQ Bank
// bank/folder/subfolder) navigate immediately via the URL query string —
// the same source of truth both this form and AddRandomButton's
// server-computed `filter` prop read from, so the visible filter and
// "Add N random" can never diverge (a prior bug class: see
// addRandomQuestions' comment on why it re-derives the test's own year
// rather than trusting an arbitrary client-supplied one).
export function QuestionFilterForm({
  subjects,
  books,
  chapters,
  topics,
  productBanks,
  mcqFolders,
  mcqSubfolders,
  filter,
}: {
  subjects: { id: string; name: string }[];
  books: { id: string; name: string; subject_id: string }[];
  chapters: { id: string; name: string; book_id: string }[];
  topics: { id: string; name: string; chapter_id: string }[];
  productBanks: { id: string; name: string }[];
  mcqFolders: {
    id: string;
    name: string;
    academic_product_subject_id: string;
  }[];
  mcqSubfolders: { id: string; name: string; folder_id: string }[];
  filter: {
    subject_id?: string;
    book_id?: string;
    chapter_id?: string;
    topic_id?: string;
    difficulty?: string;
    q?: string;
    mcq_bank_product_subject_id?: string;
    mcq_bank_folder_id?: string;
    mcq_bank_subfolder_id?: string;
  };
}) {
  const router = useRouter();

  const visibleBooks = filter.subject_id
    ? books.filter((b) => b.subject_id === filter.subject_id)
    : [];
  const visibleChapters = filter.book_id
    ? chapters.filter((c) => c.book_id === filter.book_id)
    : [];
  const visibleTopics = filter.chapter_id
    ? topics.filter((t) => t.chapter_id === filter.chapter_id)
    : [];
  const visibleFolders = filter.mcq_bank_product_subject_id
    ? mcqFolders.filter(
        (f) =>
          f.academic_product_subject_id === filter.mcq_bank_product_subject_id
      )
    : [];
  const visibleSubfolders = filter.mcq_bank_folder_id
    ? mcqSubfolders.filter((s) => s.folder_id === filter.mcq_bank_folder_id)
    : [];

  function navigate(next: {
    subject?: string;
    book?: string;
    chapter?: string;
    topic?: string;
    difficulty?: string;
    q?: string;
    bank?: string;
    folder?: string;
    subfolder?: string;
  }) {
    const merged = {
      subject: filter.subject_id ?? "",
      book: filter.book_id ?? "",
      chapter: filter.chapter_id ?? "",
      topic: filter.topic_id ?? "",
      difficulty: filter.difficulty ?? "",
      q: filter.q ?? "",
      bank: filter.mcq_bank_product_subject_id ?? "",
      folder: filter.mcq_bank_folder_id ?? "",
      subfolder: filter.mcq_bank_subfolder_id ?? "",
      ...next,
    };
    // Selecting a broader level clears anything narrower beneath it.
    if (next.subject !== undefined) {
      merged.book = "";
      merged.chapter = "";
      merged.topic = "";
    } else if (next.book !== undefined) {
      merged.chapter = "";
      merged.topic = "";
    } else if (next.chapter !== undefined) {
      merged.topic = "";
    }
    if (next.bank !== undefined) {
      merged.folder = "";
      merged.subfolder = "";
    } else if (next.folder !== undefined) {
      merged.subfolder = "";
    }
    const params = new URLSearchParams();
    if (merged.subject) params.set("subject", merged.subject);
    if (merged.book) params.set("book", merged.book);
    if (merged.chapter) params.set("chapter", merged.chapter);
    if (merged.topic) params.set("topic", merged.topic);
    if (merged.difficulty) params.set("difficulty", merged.difficulty);
    if (merged.q) params.set("q", merged.q);
    if (merged.bank) params.set("bank", merged.bank);
    if (merged.folder) params.set("folder", merged.folder);
    if (merged.subfolder) params.set("subfolder", merged.subfolder);
    router.push(`?${params.toString()}`);
  }

  // Native <select> min-content width follows long option labels; without
  // max-w-full the filter row forces the Card (overflow-hidden) wider than
  // the mobile viewport and clips CSV / pool controls on the right.
  const filterControlClass =
    "h-9 w-full max-w-full min-w-0 rounded-md border bg-transparent px-2 sm:w-auto";

  return (
    <form
      className="flex min-w-0 max-w-full flex-wrap gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        navigate({
          q: (form.elements.namedItem("q") as HTMLInputElement).value,
        });
      }}
    >
      <select
        name="subject"
        value={filter.subject_id ?? ""}
        onChange={(e) => navigate({ subject: e.target.value })}
        className={filterControlClass}
      >
        <option value="">All subjects</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {visibleBooks.length > 0 && (
        <select
          name="book"
          value={filter.book_id ?? ""}
          onChange={(e) => navigate({ book: e.target.value })}
          className={filterControlClass}
        >
          <option value="">All books</option>
          {visibleBooks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {visibleChapters.length > 0 && (
        <select
          name="chapter"
          value={filter.chapter_id ?? ""}
          onChange={(e) => navigate({ chapter: e.target.value })}
          className={filterControlClass}
        >
          <option value="">All chapters</option>
          {visibleChapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {visibleTopics.length > 0 && (
        <select
          name="topic"
          value={filter.topic_id ?? ""}
          onChange={(e) => navigate({ topic: e.target.value })}
          className={filterControlClass}
        >
          <option value="">All topics</option>
          {visibleTopics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {productBanks.length > 0 && (
        <select
          name="bank"
          value={filter.mcq_bank_product_subject_id ?? ""}
          onChange={(e) => navigate({ bank: e.target.value })}
          className={filterControlClass}
          data-testid="filter-mcq-bank"
          aria-label="MCQ Bank"
        >
          <option value="">Any MCQ Bank</option>
          {productBanks.map((b) => (
            <option key={b.id} value={b.id}>
              Bank: {b.name}
            </option>
          ))}
        </select>
      )}
      {visibleFolders.length > 0 && (
        <select
          name="folder"
          value={filter.mcq_bank_folder_id ?? ""}
          onChange={(e) => navigate({ folder: e.target.value })}
          className={filterControlClass}
          data-testid="filter-mcq-folder"
          aria-label="MCQ Bank folder"
        >
          <option value="">All folders in bank</option>
          {visibleFolders.map((f) => (
            <option key={f.id} value={f.id}>
              Folder: {f.name}
            </option>
          ))}
        </select>
      )}
      {visibleSubfolders.length > 0 && (
        <select
          name="subfolder"
          value={filter.mcq_bank_subfolder_id ?? ""}
          onChange={(e) => navigate({ subfolder: e.target.value })}
          className={filterControlClass}
          data-testid="filter-mcq-subfolder"
          aria-label="MCQ Bank subfolder"
        >
          <option value="">All subfolders in folder</option>
          {visibleSubfolders.map((s) => (
            <option key={s.id} value={s.id}>
              Subfolder: {s.name}
            </option>
          ))}
        </select>
      )}
      <select
        name="difficulty"
        value={filter.difficulty ?? ""}
        onChange={(e) => navigate({ difficulty: e.target.value })}
        className={filterControlClass}
      >
        <option value="">Any difficulty</option>
        <option value="easy">easy</option>
        <option value="medium">medium</option>
        <option value="hard">hard</option>
      </select>
      <input
        name="q"
        defaultValue={filter.q ?? ""}
        placeholder="Search text…"
        className="h-9 w-full max-w-full min-w-0 rounded-md border bg-transparent px-2 sm:w-56"
      />
      <Button type="submit" variant="secondary" size="sm">
        Search
      </Button>
    </form>
  );
}

export function AddRandomButton({
  testId,
  filter,
  poolSize,
}: {
  testId: string;
  filter: QuestionFilter;
  poolSize: number;
}) {
  const { pending, run } = useAction();
  const [n, setN] = useState(10);
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <Input type="number" min={1} max={poolSize} value={n}
        onChange={(e) => setN(Number(e.target.value))} className="h-8 w-20 shrink-0" />
      <Button size="sm" variant="outline" disabled={pending || poolSize === 0}
        data-testid="add-random-from-filter"
        className="max-w-full whitespace-normal sm:whitespace-nowrap"
        onClick={() => run(() => addRandomQuestions(testId, filter, n), "Added randomly")}>
        Add N random from this filter
      </Button>
    </div>
  );
}

export function AudiencePicker({
  testId,
  years,
  selected,
  readOnly,
}: {
  testId: string;
  years: { id: string; year_number: number }[];
  selected: string[];
  readOnly?: boolean;
}) {
  const { pending, run } = useAction();
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));

  return (
    <div className="flex flex-wrap items-center gap-4">
      {years.map((y) => (
        <label key={y.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={picked.has(y.id)}
            disabled={readOnly || pending}
            onCheckedChange={(c) => {
              const next = new Set(picked);
              if (c === true) next.add(y.id);
              else next.delete(y.id);
              setPicked(next);
            }}
          />
          Year {y.year_number}
        </label>
      ))}
      {!readOnly && (
        <Button size="sm" variant="secondary" disabled={pending}
          onClick={() => run(() => setAudienceYears(testId, [...picked]), "Audience saved")}>
          Save audience
        </Button>
      )}
    </div>
  );
}

export function PublishButton({
  testId,
  allPass,
  canPublishTests = true,
  checklistBlockReason = null,
}: {
  testId: string;
  allPass: boolean;
  /** Server-side publish_tests gate mirrored for UX (RPC still enforces). */
  canPublishTests?: boolean;
  /** When checklist fails, short actionable reason (e.g. zero questions). */
  checklistBlockReason?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { canPublish } = useTestDraftAudience();
  const [confirm, setConfirm] = useState(false);
  const disabled = !allPass || !canPublish || !canPublishTests || pending;

  const runPublish = () => {
    setConfirm(false);
    startTransition(async () => {
      const res = await publishTest(testId);
      if (res.error) toast.error(publishTestErrorMessage(res.error));
      else {
        toast.success("Published");
        router.refresh();
      }
    });
  };

  return (
    <>
      {!canPublishTests && (
        <p className="mb-2 text-sm text-destructive">
          You do not have permission to publish tests.
        </p>
      )}
      {!canPublish && (
        <p className="mb-2 text-sm text-destructive">
          Student access is set to Neither — choose Free, Both, or Paid before publishing.
        </p>
      )}
      {canPublishTests && canPublish && checklistBlockReason && (
        <p
          className="mb-2 text-sm text-destructive"
          data-testid="publish-checklist-blocked"
        >
          {checklistBlockReason}
        </p>
      )}
      <Button
        disabled={disabled}
        data-testid="publish-test-button"
        onClick={() => setConfirm(true)}
      >
        Publish test
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this test?</DialogTitle>
            <DialogDescription>
              Question versions are frozen at publish. Config and question list
              become immutable — only closing, invalidating, or voiding a
              question remain possible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={pending} onClick={runPublish}>
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KillSwitchPanel({ testId, status }: { testId: string; status: string }) {
  const { pending, run } = useAction();
  const [invalidateOpen, setInvalidateOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "published" && (
        <Button variant="outline" disabled={pending} onClick={() => setCloseOpen(true)}>
          Close test now
        </Button>
      )}
      <Button variant="destructive" disabled={pending} onClick={() => setInvalidateOpen(true)}>
        Invalidate test
      </Button>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this test now?</DialogTitle>
            <DialogDescription>
              The window ends immediately. Students still in the exam are
              finalized by the normal expiry path (transport grace applies).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button onClick={() => { setCloseOpen(false); run(() => closeTestNow(testId), "Test closed"); }}>
              Close now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={invalidateOpen} onOpenChange={setInvalidateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invalidate this test?</DialogTitle>
            <DialogDescription>
              All attempts are marked invalidated and excluded from results.
              A reason is required and audit-logged.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (required)" value={reason}
            onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvalidateOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim()}
              onClick={() => {
                setInvalidateOpen(false);
                run(() => invalidateTest(testId, reason), "Test invalidated");
              }}>
              Invalidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VoidQuestionButton({
  testId,
  questionId,
  voided,
}: {
  testId: string;
  questionId: string;
  voided: boolean;
}) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<"exclude" | "credit_all">("exclude");

  if (voided) return <span className="text-xs text-destructive">voided</span>;

  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}
        onClick={() => setOpen(true)}>
        Void…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this question?</DialogTitle>
            <DialogDescription>
              Use when a wrong answer key is discovered. All attempts are
              rescored under the chosen policy; the action is audit-logged.
            </DialogDescription>
          </DialogHeader>
          <Select value={policy} onValueChange={(v) => setPolicy(v as typeof policy)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">Exclude from total marks</SelectItem>
              <SelectItem value="credit_all">Full credit for everyone</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive"
              onClick={() => {
                setOpen(false);
                run(() => voidTestQuestion(testId, questionId, policy), "Question voided & rescored");
              }}>
              Void question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
