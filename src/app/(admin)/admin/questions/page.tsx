import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Question Bank — MedVerse Admin" };

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  draft: "secondary",
  review: "outline",
  needs_revision: "destructive",
  archived: "outline",
};

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    year?: string;
    subject?: string;
    difficulty?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  const { data: years } = await supabase
    .from("years")
    .select("id, year_number")
    .order("year_number");
  const { data: subjects } = params.year
    ? await supabase
        .from("subjects")
        .select("id, name")
        .eq("year_id", params.year)
        .order("name")
    : { data: null };

  let query = supabase
    .from("questions")
    .select(
      "id, status, difficulty, tags, used_in_test, created_at, subjects(name), chapters(name), topics(name), question_versions!questions_current_version_fk(stem, version_no)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (params.status) query = query.eq("status", params.status);
  if (params.year) query = query.eq("year_id", params.year);
  if (params.subject) query = query.eq("subject_id", params.subject);
  if (params.difficulty) query = query.eq("difficulty", params.difficulty);
  if (params.q?.trim())
    query = query.ilike("stem_normalized", `%${params.q.trim().toLowerCase()}%`);

  const { data: questions, count, error } = await query;

  const filterLink = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/admin/questions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          Question Bank{" "}
          <span className="text-base font-normal text-muted-foreground">
            {count ?? 0} shown
          </span>
        </h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/questions/import">Import CSV/Excel</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/questions/new">New question</Link>
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        {Object.entries(params)
          .filter(([k, v]) => k !== "q" && v)
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <Input
          name="q"
          placeholder="Search question text…"
          defaultValue={params.q ?? ""}
          className="w-72"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex gap-1">
          {["", "draft", "review", "approved", "needs_revision", "archived"].map((s) => (
            <Link
              key={s || "all"}
              href={filterLink({ status: s || undefined })}
              className={`rounded-md border px-2 py-1 ${
                (params.status ?? "") === s ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              {s ? s.replace("_", " ") : "all"}
            </Link>
          ))}
        </div>
        <div className="flex gap-1">
          <Link
            href={filterLink({ year: undefined, subject: undefined })}
            className={`rounded-md border px-2 py-1 ${!params.year ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            all years
          </Link>
          {(years ?? []).map((y) => (
            <Link
              key={y.id}
              href={filterLink({ year: y.id, subject: undefined })}
              className={`rounded-md border px-2 py-1 ${
                params.year === y.id ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              Y{y.year_number}
            </Link>
          ))}
        </div>
        {subjects && (
          <div className="flex flex-wrap gap-1">
            {subjects.map((s) => (
              <Link
                key={s.id}
                href={filterLink({ subject: s.id })}
                className={`rounded-md border px-2 py-1 ${
                  params.subject === s.id ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="max-w-md">Question</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Chapter / Topic</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ver.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(questions ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No questions match.
                </TableCell>
              </TableRow>
            )}
            {(questions ?? []).map((q) => {
              const v = q.question_versions as unknown as {
                stem: string;
                version_no: number;
              } | null;
              const subj = q.subjects as unknown as { name: string } | null;
              const chap = q.chapters as unknown as { name: string } | null;
              const top = q.topics as unknown as { name: string } | null;
              return (
                <TableRow key={q.id}>
                  <TableCell className="max-w-md">
                    <Link
                      href={`/admin/questions/${q.id}`}
                      className="line-clamp-2 hover:underline"
                    >
                      {v?.stem ?? "(no version)"}
                    </Link>
                    {q.used_in_test && (
                      <span className="text-xs text-muted-foreground">
                        used in test
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{subj?.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {chap?.name} / {top?.name}
                  </TableCell>
                  <TableCell>{q.difficulty}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[q.status] ?? "outline"}>
                      {q.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>v{v?.version_no ?? "?"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
