import { requireAdmin } from "@/lib/auth/require-user";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EnrollmentActions } from "./enrollment-actions";
import Link from "next/link";

export const metadata = { title: "Students — MedVerse Admin" };

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  pending: "secondary",
  suspended: "outline",
  expired: "outline",
  revoked: "destructive",
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { q, status } = await searchParams;

  let query = supabase
    .from("enrollments")
    .select(
      "id, status, created_at, student_id, years(year_number, name), profiles!enrollments_student_id_fkey(full_name, email, last_login_at)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);

  const { data: enrollments, error } = await query;

  const term = q?.toLowerCase().trim();
  const rows = (enrollments ?? []).filter((e) => {
    if (!term) return true;
    const p = e.profiles as unknown as { full_name: string; email: string };
    return (
      p?.full_name?.toLowerCase().includes(term) ||
      p?.email?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Students</h1>
        <form className="flex gap-2">
          <Input
            name="q"
            placeholder="Search name or email…"
            defaultValue={q ?? ""}
            className="w-64"
          />
          {status && <input type="hidden" name="status" value={status} />}
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      <div className="flex gap-2 text-sm">
        {["", "pending", "active", "suspended", "revoked"].map((s) => (
          <Link
            key={s || "all"}
            href={s ? `/admin/students?status=${s}` : "/admin/students"}
            className={`rounded-md border px-3 py-1 ${
              (status ?? "") === s ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            {s || "all"}
          </Link>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No students found.
                </TableCell>
              </TableRow>
            )}
            {rows.map((e) => {
              const p = e.profiles as unknown as {
                full_name: string;
                email: string;
              };
              const y = e.years as unknown as { name: string };
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{p?.full_name}</TableCell>
                  <TableCell>{p?.email}</TableCell>
                  <TableCell>{y?.name}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[e.status] ?? "outline"}>
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(e.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <EnrollmentActions
                      enrollmentId={e.id}
                      studentId={e.student_id}
                      status={e.status}
                    />
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
