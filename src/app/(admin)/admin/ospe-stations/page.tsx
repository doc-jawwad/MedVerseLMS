import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EntitlementSelect } from "@/components/admin/entitlement-select";
import { OSPE_MAX_PAGE, ospePageWindow, ospePageRows, ospePageHref } from "@/lib/admin/ospe-pagination";

export const metadata = { title: "OSPE Practice — MedVerse Admin" };

export default async function AdminOspeStationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; status?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const filters = await searchParams;

  return requireAdminClass({
    searchYear: filters.year,
    next: "/admin/ospe-stations",
    children: async (year) => {
      const yearId = year.id;
      const window = ospePageWindow(filters.page);
      const q = typeof filters.q === "string" ? filters.q.trim() : "";
      const status = filters.status === "draft" || filters.status === "published" ? filters.status : "";
      const pageHref = (page: number) => ospePageHref({ year: yearId, q, status }, page);
      let query = supabase
        .from("ospe_stations")
        .select(
          "id, title, status, entitlement, year_id, subject_id, sort_order, subjects(name), years(year_number, name)"
        )
        .eq("year_id", yearId)
        .is("deleted_at", null)
        .order("sort_order")
        .order("created_at", { ascending: false })
        .order("id")
        .range(window.start, window.end);
      if (status) query = query.eq("status", status);
      if (q) query = query.ilike("title", `%${q}%`);

      const { data, error } = await query;
      const { rows: stations, hasNext } = ospePageRows(data ?? []);

      return (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                Content
              </p>
              <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
                OSPE Practice
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {yearDisplayName(year)} — image stations with a reveal answer.
                Separate from OSPE Material packs and formal exams.
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/ospe-stations/new">Add station</Link>
            </Button>
          </div>

          <form className="flex flex-wrap gap-2" action="/admin/ospe-stations">
            <input type="hidden" name="year" value={yearId} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search title…"
              className="h-9 w-64 rounded-md border bg-background px-2 text-sm"
            />
            <select
              name="status"
              defaultValue={status}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Any status</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <Button type="submit" size="sm" variant="secondary">
              Filter
            </Button>
          </form>

          {error ? (
            <div role="alert" className="rounded-xl border p-4 text-sm text-destructive">
              Could not load OSPE stations. <Link className="underline" href={pageHref(window.page)}>Try again</Link>.
            </div>
          ) : stations.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              {window.page > 1 || q || status
                ? "No matching stations on this page."
                : "No OSPE practice stations yet. Add one with a private station image and answer."}
            </div>
          ) : (
            <div className="grid gap-3">
              {stations.map((s) => {
                const subject = s.subjects as unknown as { name: string } | null;
                return (
                  <Card key={s.id} className="shadow-none">
                    <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="text-base text-[var(--student-ink)]">
                          <Link
                            href={`/admin/ospe-stations/${s.id}`}
                            className="hover:underline"
                          >
                            {s.title}
                          </Link>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {subject ? subject.name : ""}
                          {typeof s.sort_order === "number"
                            ? ` · order ${s.sort_order}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            s.status === "published" ? "default" : "outline"
                          }
                        >
                          {s.status}
                        </Badge>
                        <EntitlementSelect
                          kind="ospe_station"
                          id={s.id}
                          value={s.entitlement}
                        />
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/ospe-stations/${s.id}`}>Edit</Link>
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}
          {!error && (window.page > 1 || hasNext) && (
            <nav aria-label="OSPE station pagination" className="flex flex-wrap items-center justify-between gap-3" data-testid="ospe-admin-pagination">
              <p className="text-sm text-muted-foreground">
                Page {window.page}{stations.length > 0 ? ` · Showing ${window.start + 1}–${window.start + stations.length}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {window.page > 1 && (
                  <Button asChild size="sm" variant="outline"><Link href={pageHref(window.page - 1)}>Previous</Link></Button>
                )}
                {hasNext && window.page < OSPE_MAX_PAGE && (
                  <Button asChild size="sm" variant="outline"><Link href={pageHref(window.page + 1)}>Next</Link></Button>
                )}
                {window.page > 1 && stations.length === 0 && (
                  <Button asChild size="sm" variant="outline"><Link href={pageHref(1)}>First page</Link></Button>
                )}
              </div>
              {hasNext && window.page === OSPE_MAX_PAGE && <p className="text-sm text-muted-foreground">Refine your filters to find more stations.</p>}
            </nav>
          )}
        </div>
      );
    },
  });
}
