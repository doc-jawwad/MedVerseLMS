import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import {
  filterAdminNav,
  getAdminPermissionSet,
} from "@/lib/admin/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, userId } = await requireAdmin();
  const perms = await getAdminPermissionSet();
  const nav = filterAdminNav(perms);
  const bottomNav = [
    nav.find((i) => i.href === "/admin") ?? nav[0],
    nav.find((i) => i.href === "/admin/students") ??
      nav.find((i) => i.href === "/admin/questions") ??
      nav[1] ??
      nav[0],
    nav.find((i) => i.href === "/admin/curriculum") ??
      nav.find((i) => i.href === "/admin/tests") ??
      nav[2] ??
      nav[0],
    nav.find((i) => i.href === "/admin/subscriptions") ??
      nav.find((i) => i.href === "/admin/materials") ??
      nav[3] ??
      nav[0],
  ].filter(Boolean);

  return (
    <div className="flex min-h-svh">
      <SessionWatch userId={userId} />
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-3 text-sm text-sidebar-foreground/80">
            {profile.full_name}
          </div>
          <div className="text-xs text-sidebar-foreground/60">Admin</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction}>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            type="submit"
          >
            Sign out
          </Button>
        </form>
      </aside>
      <div className="flex-1">
        <MobileNav
          navItems={nav}
          bottomItems={bottomNav}
          userLabel={profile.full_name}
          subLabel="Admin"
          signOutAction={signOutAction}
        />
        <main className="p-4 pb-24 md:p-8">{children}</main>
      </div>
    </div>
  );
}
