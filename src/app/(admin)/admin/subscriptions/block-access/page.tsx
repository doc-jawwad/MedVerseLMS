import { requireAdmin } from "@/lib/auth/require-user";
import { requireAdminClass } from "@/lib/admin/require-admin-class";
import { getAdminSubscriptionPermissions } from "@/lib/subscriptions/admin-permissions";
import { AdminPermissionDenied } from "@/components/admin/permission-denied";
import { SubscriptionAdminNav } from "@/components/admin/subscription-admin-nav";
import { BlockAccessManager } from "./block-access-manager";

export const metadata = { title: "Block access — MedVerse Admin" };

type SubjectRow = {
  id: string;
  name: string;
  product_key: string | null;
  free_access: boolean;
  year_id: string | null;
  year_name?: string | null;
};

export default async function AdminBlockAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const perms = await getAdminSubscriptionPermissions();
  if (!perms.manageSubscriptions) {
    return <AdminPermissionDenied title="Block access" />;
  }

  const { year: searchYear } = await searchParams;

  return requireAdminClass({
    searchYear,
    next: "/admin/subscriptions/block-access",
    children: async (year) => {
      const { data: subjects, error } = await supabase
        .from("subjects")
        .select("id, name, product_key, free_access, year_id, years(name)")
        .eq("year_id", year.id)
        .not("product_key", "is", null)
        .order("name");

      const subjectRows: SubjectRow[] = (subjects ?? []).map((s) => {
        const yr = s.years as unknown as { name: string } | null;
        return {
          id: s.id,
          name: s.name,
          product_key: s.product_key,
          free_access: s.free_access ?? false,
          year_id: s.year_id,
          year_name: yr?.name ?? year.name,
        };
      });

      return (
        <div className="grid gap-6">
          <div>
            <h1 className="text-2xl font-semibold">Block free access</h1>
            <p className="text-sm text-muted-foreground">
              Toggle free access for Blocks / Final Year subjects in {year.name}.
              Mutations require assigned-class scope server-side.
            </p>
          </div>
          <SubscriptionAdminNav currentPath="/admin/subscriptions/block-access" />
          {error && (
            <p className="text-sm text-destructive">
              Could not load this page. Please try again.
            </p>
          )}
          <BlockAccessManager subjects={subjectRows} />
        </div>
      );
    },
  });
}
