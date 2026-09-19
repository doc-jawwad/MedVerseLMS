import { requireStudent } from "@/lib/auth/require-user";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { AppShellNav } from "@/components/student/app-shell-nav";
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
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-4 text-sm font-medium text-white">
            {profile.full_name}
          </div>
          <div className="mt-1 w-fit rounded-full bg-white/10 px-2 py-0.5 text-[11px] tracking-wide text-sidebar-foreground/80">
            {enrollment.year_name}
          </div>
        </div>
        <AppShellNav items={nav} />
        <form action={signOutAction} className="mt-4">
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
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          navItems={nav}
          bottomItems={bottomItems}
          userLabel={profile.full_name}
          subLabel={enrollment.year_name}
          signOutAction={signOutAction}
        />
        <main className="flex-1 p-4 pb-24 md:p-8">{children}</main>
      </div>
    </div>
  );
}
