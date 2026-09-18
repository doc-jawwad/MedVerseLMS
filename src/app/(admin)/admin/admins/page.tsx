import { requireAdmin } from "@/lib/auth/require-user";
import { AdminsManager } from "./admins-manager";
import type { AdminAccountRow } from "@/lib/admin/admin-rbac-ui";

export const metadata = { title: "Admins — MedVerse Admin" };

export default async function AdminsPage() {
  const { supabase } = await requireAdmin();

  const { data: canManageRes } = await supabase.rpc("has_permission", {
    p_code: "manage_admins",
  });
  const canManage = Boolean(canManageRes);

  const [{ data: profiles, error: profileError }, { data: permRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, full_name, email, account_status, is_main_admin, last_login_at"
        )
        .eq("role", "admin")
        .order("full_name", { ascending: true }),
      supabase.from("admin_permissions").select("admin_id, permission_code"),
    ]);

  const codesByAdmin = new Map<string, string[]>();
  for (const row of permRows ?? []) {
    const list = codesByAdmin.get(row.admin_id) ?? [];
    list.push(row.permission_code);
    codesByAdmin.set(row.admin_id, list);
  }

  const admins: AdminAccountRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    account_status: p.account_status,
    is_main_admin: Boolean(p.is_main_admin),
    last_login_at: p.last_login_at,
    permission_codes: codesByAdmin.get(p.id) ?? [],
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Admins</h1>
        <p className="text-sm text-muted-foreground">
          Main Admin can create other admins, assign jobs, disable access, or
          remove admin rights. The last Main Admin stays protected.
        </p>
      </div>
      {profileError && (
        <p className="text-sm text-destructive">
          Could not load admins. Please try again.
        </p>
      )}
      <AdminsManager admins={admins} canManage={canManage} />
    </div>
  );
}
