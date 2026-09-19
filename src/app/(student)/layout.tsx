import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav, type NavItem } from "@/components/mobile-nav";
import {
  bindSsrTiming,
  scheduleSsrTimingFlush,
} from "@/lib/observability/ssr-timing-rsc";

const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/materials", label: "Study Materials", icon: "materials" },
  { href: "/practice", label: "Practice MCQs", icon: "practice" },
  { href: "/tests", label: "Tests", icon: "tests" },
  { href: "/performance", label: "Performance", icon: "performance" },
  { href: "/subscription", label: "My Subscription", icon: "subscription" },
  { href: "/profile", label: "My Account", icon: "account" },
];

// The 4 most-used links pinned to the mobile bottom tab bar; a 5th "More"
// tab opens the drawer with the full list above (Materials + Subscription + Account).
const bottomNav = [nav[0], nav[2], nav[3], nav[4]];

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await bindSsrTiming();
  scheduleSsrTimingFlush();
  const { profile, enrollment, userId } = await requireStudent();
  const isBlockedExamContinue = isBlockedAccountStatus(profile.account_status);

  // Blocked accounts with leave_in_progress may only see the exam player —
  // never the student shell nav (dashboard / payments / year-change, etc.).
  if (isBlockedExamContinue) {
    return (
      <div className="min-h-svh">
        <SessionWatch userId={userId} />
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh">
      <SessionWatch userId={userId} />
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-3 text-sm text-sidebar-foreground/80">
            {profile.full_name}
          </div>
          <div className="text-xs text-sidebar-foreground/60">
            {enrollment.year_name}
          </div>
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
          subLabel={enrollment.year_name}
          signOutAction={signOutAction}
        />
        <main className="p-4 pb-24 md:p-8">{children}</main>
      </div>
    </div>
  );
}
