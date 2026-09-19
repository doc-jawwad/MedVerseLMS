import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Tests — MedVerse Admin" };

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  published: "default",
  draft: "secondary",
  closed: "outline",
  archived: "outline",
  invalidated: "destructive",
};

export default async function AdminTestsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/tests",
    children: async (year) => {
      const { data: tests } = await supabase
        .from("tests")
        .select(
          "id, title, status, opens_at, closes_at, duration_minutes, years(year_number), subjects(name), test_questions(count)"
        )
        .eq("year_id", year.id)
        .order("created_at", { ascending: false });

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--brand-navy)]">
            Tests
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {yearDisplayName(year)} — publish, schedule, and review assessments.
          </p>
        </div>
        <Button asChild className="h-9">
          <Link href="/admin/tests/new">Create test</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[10rem]">Title</TableHead>
              <TableHead className="hidden sm:table-cell">Year</TableHead>
              <TableHead className="hidden md:table-cell">Subject</TableHead>
              <TableHead>Questions</TableHead>
              <TableHead className="hidden lg:table-cell">Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(tests ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No tests yet.
                </TableCell>
              </TableRow>
            )}
            {(tests ?? []).map((t) => {
              const y = t.years as unknown as { year_number: number } | null;
              const s = t.subjects as unknown as { name: string } | null;
              const qc = (t.test_questions as unknown as { count: number }[])?.[0]?.count ?? 0;
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/admin/tests/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    Y{y?.year_number}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s?.name ?? "—"}
                  </TableCell>
                  <TableCell>{qc}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {t.opens_at ? formatDateTime(t.opens_at) : "unscheduled"}
                    {" → "}
                    {t.closes_at ? formatDateTime(t.closes_at) : "?"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[t.status] ?? "outline"}>{t.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {t.status !== "draft" && (
                      <Link
                        href={`/admin/tests/${t.id}/results`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        Results
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
    },
  });
}
