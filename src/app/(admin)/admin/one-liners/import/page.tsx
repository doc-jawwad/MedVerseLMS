import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { ImportOneLinersClient } from "./import-one-liners-client";

export const metadata = { title: "Import One-liners — MedVerse Admin" };

export default async function ImportOneLinersPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/one-liners/import",
    children: async (year) => (
      <div className="grid gap-6">
        <div>
          <Link href="/admin/one-liners" className="text-sm text-muted-foreground hover:underline">
            ← One-liners
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-semibold text-[var(--student-ink)]">
            Import One-liners — CSV
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bulk import for {year.name}. Headers: <code>title, body, subject, status</code>.
          </p>
        </div>
        <ImportOneLinersClient yearId={year.id} />
      </div>
    ),
  });
}
