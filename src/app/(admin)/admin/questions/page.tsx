import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { setAdminClassAction } from "@/lib/actions/admin-class";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuestionsBulkTable } from "./questions-bulk-table";

export const metadata = { title: "Question Bank — MedVerse Admin" };

const PAGE_SIZE = 50;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first", column: "created_at", ascending: false },
  { value: "oldest", label: "Oldest first", column: "created_at", ascending: true },
] as const;

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    year?: string;
    subject?: string;
    book?: string;
    chapter?: string;
    topic?: string;
    difficulty?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const gate = await requireAdminAnyPermission(
    ["edit_questions", "import_questions"],
    "Question Bank"
  );
  if (gate.denied) return gate.denied;
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/questions",
    children: async (year) => {
      const yearFilter = year.id;
      const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
      const sort =
        SORT_OPTIONS.find((s) => s.value === params.sort) ?? SORT_OPTIONS[0];

      const { data: years } = await supabase
        .from("years")
        .select("id, year_number, name")
        .order("year_number");
      const { data: subjects } = await supabase
        .from("subjects")
        .select("id, name")
        .eq("year_id", yearFilter)
        .order("name");
      const { data: books } = params.subject
        ? await supabase
            .from("books")
            .select("id, name")
            .eq("subject_id", params.subject)
            .order("name")
        : { data: null };
      const { data: chapters } = params.book
        ? await supabase
            .from("chapters")
            .select("id, name")
            .eq("book_id", params.book)
            .order("sort_order")
            .order("name")
        : { data: null };
      const { data: topics } = params.chapter
        ? await supabase
            .from("topics")
            .select("id, name")
            .eq("chapter_id", params.chapter)
            .order("sort_order")
            .order("name")
        : { data: null };

      let query = supabase
        .from("questions")
        .select(
          "id, status, difficulty, tags, used_in_test, created_at, subjects(name), chapters(name), topics(name), question_versions!questions_current_version_fk(stem, version_no)",
          { count: "exact" }
        )
        .is("deleted_at", null)
        .order(sort.column, { ascending: sort.ascending })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (params.status) query = query.eq("status", params.status);
      query = query.eq("year_id", yearFilter);
      if (params.subject) query = query.eq("subject_id", params.subject);
      if (params.book) query = query.eq("book_id", params.book);
      if (params.chapter) query = query.eq("chapter_id", params.chapter);
      if (params.topic) query = query.eq("topic_id", params.topic);
      if (params.difficulty) query = query.eq("difficulty", params.difficulty);
      if (params.q?.trim())
        query = query.ilike(
          "stem_normalized",
          `%${params.q.trim().toLowerCase()}%`
        );

      const { data: questions, count, error } = await query;
      const totalCount = count ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
      const rangeEnd = Math.min(page * PAGE_SIZE, totalCount);

      // Any filter/sort change resets to page 1, unless the patch is itself a
      // page change (pagination links pass `page` explicitly).
      const filterLink = (patch: Record<string, string | undefined>) => {
        const merged = { ...params, year: yearFilter, page: undefined, ...patch };
        const qs = Object.entries(merged)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
          .join("&");
        return `/admin/questions${qs ? `?${qs}` : ""}`;
      };

      return (
        <div className="grid gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Question Bank
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {totalCount === 0
                  ? "No questions match these filters"
                  : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="h-9">
                <Link href="/admin/questions/import">Import CSV/Excel</Link>
              </Button>
              <Button asChild className="h-9">
                <Link href="/admin/questions/new">New question</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/80 bg-card p-3 sm:p-4">
            <form className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {Object.entries(params)
                .filter(([k, v]) => k !== "q" && v)
                .map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
              <Input
                name="q"
                placeholder="Search question text…"
                defaultValue={params.q ?? ""}
                className="h-9 min-w-0 flex-1 sm:max-w-md"
              />
              <Button type="submit" variant="secondary" className="h-9 shrink-0">
                Search
              </Button>
            </form>

            <div className="grid gap-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {["", "draft", "review", "approved", "needs_revision", "archived"].map(
                  (s) => (
                    <Link
                      key={s || "all"}
                      href={filterLink({ status: s || undefined })}
                      className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
                        (params.status ?? "") === s
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {s ? s.replace("_", " ") : "all statuses"}
                    </Link>
                  )
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(years ?? []).map((y) => (
                  <form key={y.id} action={setAdminClassAction}>
                    <input type="hidden" name="yearId" value={y.id} />
                    <input type="hidden" name="next" value="/admin/questions" />
                    <button
                      type="submit"
                      data-testid={`admin-year-chip-${y.year_number}`}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        yearFilter === y.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      Y{y.year_number}
                    </button>
                  </form>
                ))}
              </div>
              {subjects && (
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={filterLink({
                      subject: undefined,
                      book: undefined,
                      chapter: undefined,
                      topic: undefined,
                    })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${!params.subject ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent/60"}`}
                  >
                    all subjects
                  </Link>
                  {subjects.map((s) => (
                    <Link
                      key={s.id}
                      href={filterLink({
                        subject: s.id,
                        book: undefined,
                        chapter: undefined,
                        topic: undefined,
                      })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        params.subject === s.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {s.name}
                    </Link>
                  ))}
                </div>
              )}
              {books && (
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={filterLink({
                      book: undefined,
                      chapter: undefined,
                      topic: undefined,
                    })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${!params.book ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent/60"}`}
                  >
                    all books
                  </Link>
                  {books.map((b) => (
                    <Link
                      key={b.id}
                      href={filterLink({
                        book: b.id,
                        chapter: undefined,
                        topic: undefined,
                      })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        params.book === b.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {b.name}
                    </Link>
                  ))}
                </div>
              )}
              {chapters && (
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={filterLink({ chapter: undefined, topic: undefined })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${!params.chapter ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent/60"}`}
                  >
                    all chapters
                  </Link>
                  {chapters.map((c) => (
                    <Link
                      key={c.id}
                      href={filterLink({ chapter: c.id, topic: undefined })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        params.chapter === c.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              )}
              {topics && (
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={filterLink({ topic: undefined })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${!params.topic ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent/60"}`}
                  >
                    all topics
                  </Link>
                  {topics.map((t) => (
                    <Link
                      key={t.id}
                      href={filterLink({ topic: t.id })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        params.topic === t.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {t.name}
                    </Link>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                {["", "easy", "medium", "hard"].map((d) => (
                  <Link
                    key={d || "all"}
                    href={filterLink({ difficulty: d || undefined })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      (params.difficulty ?? "") === d
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-accent/60"
                    }`}
                  >
                    {d || "any difficulty"}
                  </Link>
                ))}
              </div>
              <div className="flex gap-1">
                {SORT_OPTIONS.map((s) => (
                  <Link
                    key={s.value}
                    href={filterLink({
                      sort: s.value === "newest" ? undefined : s.value,
                    })}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      sort.value === s.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-accent/60"
                    }`}
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">
              Could not load this page. Please try again.
            </p>
          )}

          {/* Draft / review indicator — prominent approval queue link */}
          {!params.status && (() => {
            const draftCount = (questions ?? []).filter(
              (q) => q.status === "draft" || q.status === "review"
            ).length;
            return draftCount > 0 ? (
              <Link
                href={filterLink({ status: "review" })}
                className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                  {draftCount}
                </Badge>
                question{draftCount !== 1 ? "s" : ""} awaiting review/approval — click to filter
              </Link>
            ) : null;
          })()}

          <QuestionsBulkTable
            questions={(questions ?? []).map((q) => ({
              id: q.id,
              status: q.status,
              difficulty: q.difficulty ?? null,
              used_in_test: q.used_in_test ?? null,
              subjects: q.subjects as unknown as { name: string } | null,
              chapters: q.chapters as unknown as { name: string } | null,
              topics: q.topics as unknown as { name: string } | null,
              question_versions: q.question_versions as unknown as { stem: string; version_no: number } | null,
            }))}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={filterLink({
                      page: page > 2 ? String(page - 1) : undefined,
                    })}
                  >
                    ← Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  ← Previous
                </Button>
              )}
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={filterLink({ page: String(page + 1) })}>
                    Next →
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next →
                </Button>
              )}
            </div>
          )}
        </div>
      );
    },
  });
}
