import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { ImportPearlsClient } from "./import-pearls-client";

export const metadata = { title: "Import Pearl Points — MedVerse Admin" };

export default async function ImportPearlsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/pearls/import",
    children: async (year) => (
      <div className="grid gap-6">
        <div>
          <Link href="/admin/pearls" className="text-sm text-muted-foreground hover:underline">
            ← Pearl Points
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-semibold text-[var(--student-ink)]">
            Import Pearl Points — CSV
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bulk import for {year.name}. Required headers: <code>prompt, answer</code>.
          </p>
        </div>
        <ImportPearlsClient yearId={year.id} />
      </div>
    ),
  });
}
