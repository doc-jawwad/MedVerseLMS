import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { yearDisplayName } from "@/lib/library/types";
import { listContentBin } from "@/lib/actions/content-bin";
import { CONTENT_BIN_PAGE_SIZE } from "@/lib/content-bin/purge-batch";
import { ContentBinAdmin } from "./content-bin-admin";

export const metadata = { title: "Content Bin — MedVerse Admin" };

export default async function AdminBinPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const gate = await requireAdminAnyPermission(
    ["manage_materials", "edit_questions"],
    "Content Bin"
  );
  if (gate.denied) return gate.denied;
  const params = await searchParams;
  const pageRaw = Number(params.page ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const offset = (page - 1) * CONTENT_BIN_PAGE_SIZE;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/bin",
    children: async (year) => {
      const { items, totalCount, error } = await listContentBin(year.id, {
        limit: CONTENT_BIN_PAGE_SIZE,
        offset,
      });
      return (
        <div className="grid gap-4">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ContentBinAdmin
            yearLabel={yearDisplayName(year)}
            yearId={year.id}
            items={items}
            totalCount={totalCount}
            page={page}
            pageSize={CONTENT_BIN_PAGE_SIZE}
          />
        </div>
      );
    },
  });
}
