import { requireAdmin } from "@/lib/auth/require-user";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export const metadata = { title: "Audit Log — MedVerse Admin" };

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; target_type?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { action, target_type, page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? 1));

  let query = supabase
    .from("audit_logs")
    .select(
      "id, action, target_type, target_id, details, created_at, profiles(full_name, email)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1);

  if (action) query = query.eq("action", action);
  if (target_type) query = query.eq("target_type", target_type);

  const [{ data: logs, count }, { data: actionTypes }, { data: targetTypes }] =
    await Promise.all([
      query,
      supabase.from("audit_logs").select("action").limit(1000),
      supabase.from("audit_logs").select("target_type").limit(1000),
    ]);

  const uniqueActions = [...new Set((actionTypes ?? []).map((a) => a.action))].sort();
  const uniqueTargets = [...new Set((targetTypes ?? []).map((t) => t.target_type))].sort();

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const filterLink = (patch: Record<string, string | undefined>) => {
    const merged = { action, target_type, ...patch };
    const qs = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/admin/audit-logs${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">
        Audit Log{" "}
        <span className="text-base font-normal text-muted-foreground">
          {count ?? 0} entries
        </span>
      </h1>

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex flex-wrap gap-1">
          <Link
            href={filterLink({ action: undefined })}
            className={`rounded-md border px-2 py-1 ${!action ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            all actions
          </Link>
          {uniqueActions.map((a) => (
            <Link
              key={a}
              href={filterLink({ action: a })}
              className={`rounded-md border px-2 py-1 ${action === a ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              {a}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link
            href={filterLink({ target_type: undefined })}
            className={`rounded-md border px-2 py-1 ${!target_type ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            all targets
          </Link>
          {uniqueTargets.map((t) => (
            <Link
              key={t}
              href={filterLink({ target_type: t })}
              className={`rounded-md border px-2 py-1 ${target_type === t ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(logs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No matching entries.
                </TableCell>
              </TableRow>
            )}
            {(logs ?? []).map((l) => {
              const actor = l.profiles as unknown as { full_name: string } | null;
              return (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(l.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{actor?.full_name ?? "system"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.target_type}
                    {l.target_id && ` (${l.target_id.slice(0, 8)}…)`}
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                    {Object.keys(l.details ?? {}).length > 0
                      ? JSON.stringify(l.details)
                      : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {pageNum > 1 && (
            <Link href={filterLink({ page: String(pageNum - 1) })} className="underline">
              ← Previous
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link href={filterLink({ page: String(pageNum + 1) })} className="underline">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
