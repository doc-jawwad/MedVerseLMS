import { requireAdmin } from "@/lib/auth/require-user";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { ShellNav } from "@/components/shell-nav";
import { BrandCredit } from "@/components/brand-credit";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";
import {
  filterAdminNav,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";
import { readAdminSelectedYearId } from "@/lib/admin/selected-class";
import { AdminClassSelector } from "@/components/admin/class-selector";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, userId, supabase } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  const nav = filterAdminNav(perms);
  const [{ data: years }, selectedYearId] = await Promise.all([
    supabase.from("years").select("id, year_number, name").order("year_number"),
    readAdminSelectedYearId(),
  ]);

  return (
    <div className="flex min-h-svh bg-[var(--student-canvas)]">
      <SessionWatch userId={userId} />
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-4 truncate text-sm font-medium text-white">
            {profile.full_name}
          </div>
          <div className="mt-1 text-[11px] tracking-[0.14em] text-sidebar-foreground/55 uppercase">
            Admin
          </div>
        </div>
        <ShellNav items={nav} />
        <div className="mt-4 space-y-3">
          <InstallMedverseApp variant="nav" />
          <form action={signOutAction}>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              type="submit"
            >
              Sign out
            </Button>
          </form>
          <BrandCredit tone="sidebar" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          navItems={nav}
          userLabel={profile.full_name}
          subLabel="Admin"
          signOutAction={signOutAction}
          showBottomNav={false}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8 md:py-8">
          <div className="mb-4">
            <AdminClassSelector
              years={years ?? []}
              selectedId={selectedYearId}
            />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
