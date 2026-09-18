import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { YearChangeActions } from "./year-change-actions";
import { yearChangeStatusLabel } from "@/lib/year-changes/errors";

export const metadata = { title: "Year changes — MedVerse Admin" };

type ProfileJoin = { full_name: string | null; email: string | null };
type YearJoin = { name: string | null; year_number: number | null };

export default async function AdminYearChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { status, q } = await searchParams;
  const filter = status ?? "pending";

  const { data: canManageRes } = await supabase.rpc("has_permission", {
    p_code: "manage_year_changes",
  });
  const canManage = Boolean(canManageRes);

  let query = supabase
    .from("year_change_requests")
    .select(
      "id, status, reason, review_note, created_at, reviewed_at, student_id, from_year_id, to_year_id, profiles!year_change_requests_student_id_fkey(full_name, email), from_year:years!year_change_requests_from_year_id_fkey(name, year_number), to_year:years!year_change_requests_to_year_id_fkey(name, year_number)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (filter && filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  const term = q?.toLowerCase().trim();
  const rows = (data ?? []).filter((r) => {
    if (!term) return true;
    const p = r.profiles as unknown as ProfileJoin | null;
    return (
      p?.full_name?.toLowerCase().includes(term) ||
      p?.email?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Year change requests</h1>
        <p className="text-sm text-muted-foreground">
          Approval moves the student&apos;s active class enrollment. Account
          status and subscriptions stay separate.
        </p>
      </div>

      {!canManage && (
        <p className="text-sm text-muted-foreground">
          Review actions require <code>manage_year_changes</code>.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Could not load requests. Please try again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 text-sm">
          {["pending", "approved", "rejected", "all"].map((s) => (
            <Link
              key={s}
              href={
                s === "all"
                  ? "/admin/year-changes?status=all"
                  : `/admin/year-changes?status=${s}`
              }
              className={`rounded-md border px-3 py-1 ${
                filter === s ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              {s}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          <Input
            name="q"
            placeholder="Search student…"
            defaultValue={q ?? ""}
            className="w-56"
          />
          {filter !== "pending" && (
            <input type="hidden" name="status" value={filter} />
          )}
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Current → Requested</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground"
                >
                  No year-change requests in this view.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const profile = r.profiles as unknown as ProfileJoin | null;
              const fromY = r.from_year as unknown as YearJoin | null;
              const toY = r.to_year as unknown as YearJoin | null;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">
                      <Link
                        href={`/admin/students/${r.student_id}`}
                        className="hover:underline"
                      >
                        {profile?.full_name ?? "—"}
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {profile?.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {fromY?.name ?? "—"} → {toY?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "pending"
                          ? "default"
                          : r.status === "approved"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {yearChangeStatusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(r.created_at)}
                  </TableCell>
                  <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">
                    {r.review_note || r.reason || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "pending" ? (
                      <YearChangeActions
                        requestId={r.id}
                        canManage={canManage}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
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
