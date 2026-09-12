import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
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

export default async function AdminTestsPage() {
  const { supabase } = await requireAdmin();

  const { data: tests } = await supabase
    .from("tests")
    .select(
      "id, title, status, opens_at, closes_at, duration_minutes, years(year_number), subjects(name), test_questions(count)"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tests</h1>
        <Button asChild>
          <Link href="/admin/tests/new">Create test</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Questions</TableHead>
              <TableHead>Window</TableHead>
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
                  <TableCell>Y{y?.year_number}</TableCell>
                  <TableCell>{s?.name ?? "—"}</TableCell>
                  <TableCell>{qc}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
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
}
