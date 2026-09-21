import { requireAdmin } from "@/lib/auth/require-user";
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

  const { year: filterYearId } = await searchParams;

  const [{ data: subjects, error }, { data: years }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name, product_key, free_access, year_id, years(year_name)")
      .not("product_key", "is", null)
      .order("year_id")
      .order("name"),
    supabase
      .from("years")
      .select("id, year_name, year_number")
      .order("year_number"),
  ]);

  const subjectRows: SubjectRow[] = (subjects ?? []).map((s) => {
    const yr = s.years as unknown as { year_name: string } | null;
    return {
      id: s.id,
      name: s.name,
      product_key: s.product_key,
      free_access: s.free_access ?? false,
      year_id: s.year_id,
      year_name: yr?.year_name ?? null,
    };
  });

  const yearOptions = (years ?? []).map((y) => ({
    id: y.id,
    year_name: y.year_name,
    year_number: y.year_number,
  }));

  const visibleSubjects = filterYearId
    ? subjectRows.filter((s) => s.year_id === filterYearId)
    : subjectRows;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Block free access</h1>
        <p className="text-sm text-muted-foreground">
          Toggle whether free (non-subscribed) students can access a Block or
          Final Year subject. Uses the existing{" "}
          <code>product_key</code> Block model — only subjects with a product
          key are shown. Security is enforced server-side; toggling here is the
          only way to open a Block for free students.
        </p>
      </div>
      <SubscriptionAdminNav currentPath="/admin/subscriptions/block-access" />
      {error && (
        <p className="text-sm text-destructive">
          Could not load this page. Please try again.
        </p>
      )}

      {yearOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="/admin/subscriptions/block-access"
            className={`rounded-md border px-3 py-1 ${!filterYearId ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            All classes
          </a>
          {yearOptions.map((y) => (
            <a
              key={y.id}
              href={`/admin/subscriptions/block-access?year=${y.id}`}
              className={`rounded-md border px-3 py-1 ${filterYearId === y.id ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              {y.year_name}
            </a>
          ))}
        </div>
      )}

      <BlockAccessManager subjects={visibleSubjects} />
    </div>
  );
}
