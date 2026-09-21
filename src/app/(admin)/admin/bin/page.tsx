import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { listContentBin } from "@/lib/actions/content-bin";
import { ContentBinAdmin } from "./content-bin-admin";

export const metadata = { title: "Content Bin — MedVerse Admin" };

export default async function AdminBinPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/bin",
    children: async (year) => {
      const { items, error } = await listContentBin(year.id);
      return (
        <div className="grid gap-4">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ContentBinAdmin yearLabel={yearDisplayName(year)} items={items} />
        </div>
      );
    },
  });
}
