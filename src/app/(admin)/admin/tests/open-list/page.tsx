import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { requireAdminAnyPermission } from "@/lib/admin/require-admin-permission";
import { yearDisplayName } from "@/lib/library/types";
import {
  OpenListAdmin,
  type OpenListGroupRow,
  type OpenListTestRow,
} from "./open-list-admin";

export const metadata = { title: "Open-test groups — MedVerse Admin" };

export default async function AdminOpenListPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const gate = await requireAdminAnyPermission(["publish_tests"], "Open-test groups");
  if (gate.denied) return gate.denied;
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  return requireAdminClass({
    searchYear: params.year,
    next: "/admin/tests/open-list",
    children: async (year) => {
      const [{ data: groups }, { data: tests }, { data: placements }] =
        await Promise.all([
          supabase
            .from("test_open_list_groups")
            .select("id, name, sort_order")
            .eq("year_id", year.id)
            .order("sort_order", { ascending: true }),
          supabase
            .from("tests")
            .select("id, title, status, opens_at, closes_at")
            .eq("year_id", year.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("test_open_list_placements")
            .select("test_id, group_id, sort_order")
            .eq("year_id", year.id),
        ]);

      const placementByTest = new Map(
        (placements ?? []).map((p) => [
          p.test_id as string,
          {
            group_id: (p.group_id as string | null) ?? null,
            sort_order: p.sort_order as number,
          },
        ])
      );

      const testRows: OpenListTestRow[] = (tests ?? []).map((t) => {
        const placement = placementByTest.get(t.id as string);
        return {
          id: t.id as string,
          title: t.title as string,
          status: t.status as string,
          opens_at: (t.opens_at as string | null) ?? null,
          closes_at: (t.closes_at as string | null) ?? null,
          group_id: placement?.group_id ?? null,
          sort_order: placement?.sort_order ?? null,
        };
      });

      const groupRows: OpenListGroupRow[] = (groups ?? []).map((g) => ({
        id: g.id as string,
        name: g.name as string,
        sort_order: g.sort_order as number,
      }));

      return (
        <OpenListAdmin
          yearId={year.id}
          yearLabel={yearDisplayName(year)}
          groups={groupRows}
          tests={testRows}
        />
      );
    },
  });
}
