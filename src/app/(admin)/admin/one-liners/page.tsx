import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "One-liners — MedVerse Admin" };

export default async function AdminOneLinersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; status?: string }>;
}) {
  const gate = await requireAdminAnyPermission(
    ["manage_materials"],
    "One-liners"
  );
  if (gate.denied) return gate.denied;
  const { supabase } = await requireAdmin();
  const filters = await searchParams;

  return requireAdminClass({
    searchYear: filters.year,
    next: "/admin/one-liners",
    children: async (year) => {
      const yearId = year.id;
      let query = supabase
        .from("one_liners")
        .select("id, title, status, year_id, subject_id, subjects(name)")
        .eq("year_id", yearId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (filters.status === "draft" || filters.status === "published") {
        query = query.eq("status", filters.status);
      }
      if (filters.q?.trim())
        query = query.ilike("title", `%${filters.q.trim()}%`);

      const { data: items } = await query;

      return (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                Content
              </p>
              <h1 className="font-heading text-2xl font-semibold text-[var(--student-ink)]">
                One-liners
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {items?.length ?? 0} one-liner(s) for {year.name}
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/one-liners/import">CSV Import</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/admin/one-liners/new">+ New One-liner</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            {(items ?? []).map((item) => (
              <Link
                key={item.id}
                href={`/admin/one-liners/${item.id}`}
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/40"
              >
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {(item.subjects as unknown as { name: string } | null)?.name ?? "—"}
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === "published" ? "default" : "secondary"
                  }
                >
                  {item.status}
                </Badge>
              </Link>
            ))}
            {(items?.length ?? 0) === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No one-liners yet. Create one or import via CSV.
              </p>
            )}
          </div>
        </div>
      );
    },
  });
}
