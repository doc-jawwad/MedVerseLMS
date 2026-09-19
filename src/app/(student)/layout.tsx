import { requireStudent } from "@/lib/auth/require-user";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { ShellNav } from "@/components/shell-nav";
import { BrandCredit } from "@/components/brand-credit";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { buildStudentShellNav } from "@/lib/subscriptions/student-section-access";
import {
  bindSsrTiming,
  scheduleSsrTimingFlush,
} from "@/lib/observability/ssr-timing-rsc";

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
      <div className="min-h-svh bg-[var(--student-canvas)]">
        <SessionWatch userId={userId} />
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }

  const hasLiveAccess = await getStudentHasLiveSubscription();
  const { items: nav, bottomItems } = buildStudentShellNav(hasLiveAccess);

  return (
    <div className="flex min-h-svh bg-[var(--student-canvas)]">
      <SessionWatch userId={userId} />
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-4 truncate text-sm font-medium text-white">
            {profile.full_name}
          </div>
          <div className="mt-1.5 w-fit rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] tracking-wide text-sidebar-foreground/80">
            {enrollment.year_name}
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
          bottomItems={bottomItems}
          userLabel={profile.full_name}
          subLabel={enrollment.year_name}
          signOutAction={signOutAction}
          showBottomNav
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
