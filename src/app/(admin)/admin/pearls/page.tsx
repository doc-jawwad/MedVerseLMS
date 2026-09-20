import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EntitlementSelect } from "@/components/admin/entitlement-select";

export const metadata = { title: "Pearl Points — MedVerse Admin" };

export default async function AdminPearlsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; status?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const filters = await searchParams;

  return requireAdminClass({
    searchYear: filters.year,
    next: "/admin/pearls",
    children: async (year) => {
      const yearId = year.id;
      let query = supabase
        .from("pearl_points")
        .select(
          "id, prompt, status, entitlement, year_id, subject_id, subjects(name), years(year_number, name)"
        )
        .eq("year_id", yearId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (filters.status === "draft" || filters.status === "published") {
        query = query.eq("status", filters.status);
      }
      if (filters.q?.trim())
        query = query.ilike("prompt", `%${filters.q.trim()}%`);

      const { data: pearls } = await query;

      return (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                Content
              </p>
              <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
                Pearl Points
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {yearDisplayName(year)} — high-yield recall points for this class.
                These are not Question Bank MCQs and are not scored.
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/pearls/new">Add Pearl Point</Link>
            </Button>
          </div>

          <form className="flex flex-wrap gap-2" action="/admin/pearls">
            <input type="hidden" name="year" value={yearId} />
            <input
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Search prompt…"
              className="h-9 w-64 rounded-md border bg-background px-2 text-sm"
            />
            <select
              name="status"
              defaultValue={filters.status ?? ""}
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

          {(pearls ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              No pearl points yet. Add one to start a rapid-revision set for
              students.
            </div>
          ) : (
            <div className="grid gap-3">
              {(pearls ?? []).map((p) => {
                const subject = p.subjects as unknown as { name: string } | null;
                const yearRow = p.years as unknown as {
                  year_number: number;
                } | null;
                return (
                  <Card key={p.id} className="shadow-none">
                    <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="text-base text-[var(--student-ink)]">
                          <Link
                            href={`/admin/pearls/${p.id}`}
                            className="hover:underline"
                          >
                            {p.prompt}
                          </Link>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {yearRow ? `Year ${yearRow.year_number}` : ""}
                          {subject ? ` · ${subject.name}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            p.status === "published" ? "default" : "outline"
                          }
                        >
                          {p.status}
                        </Badge>
                        <EntitlementSelect
                          kind="pearl_point"
                          id={p.id}
                          value={p.entitlement}
                        />
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/pearls/${p.id}`}>Edit</Link>
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      );
    },
  });
}
