"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";
import { MobileNav, type NavItem } from "@/components/mobile-nav";
import { ShellNav } from "@/components/shell-nav";
import { BrandCredit } from "@/components/brand-credit";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";
import { ShellTools } from "@/components/shell-tools";
import { isExamLikePath } from "@/lib/pwa/install";
import type { AcademicTreeSurface } from "@/lib/academic-tree";

/**
 * Student chrome that isolates formal exam / preview from shell navigation.
 * Reuses `isExamLikePath` (same rule as ExamPwaGuard / PWA install hiding).
 * Must be a client component so pathname can gate chrome without passing
 * render functions across the server→client boundary.
 */
export function StudentShellChrome({
  userId,
  userLabel,
  subLabel,
  nav,
  bottomItems,
  surface,
  yearId,
  yearNumber,
  yearName,
  hasLiveAccess,
  signOutAction,
  children,
}: {
  userId: string;
  userLabel: string;
  subLabel: string;
  nav: NavItem[];
  bottomItems: NavItem[];
  surface: AcademicTreeSurface;
  yearId: string;
  yearNumber: number;
  yearName: string;
  hasLiveAccess: boolean;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const exam = isExamLikePath(pathname);

  if (exam) {
    return (
      <div className="min-h-svh bg-[var(--student-canvas)]">
        <SessionWatch userId={userId} />
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }

  const tools = (
    <ShellTools
      surface={surface}
      yearId={yearId}
      yearNumber={yearNumber}
      yearName={yearName}
      hasLiveSubscription={hasLiveAccess}
    />
  );

  return (
    <div className="flex min-h-svh bg-[var(--student-canvas)]">
      <SessionWatch userId={userId} />
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-4 truncate text-sm font-medium text-white">
            {userLabel}
          </div>
          <div className="mt-1.5 w-fit rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] tracking-wide text-sidebar-foreground/80">
            {subLabel}
          </div>
        </div>
        <ShellNav items={nav} />
        <div className="mt-4 space-y-3">
          {tools}
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
          userLabel={userLabel}
          subLabel={subLabel}
          signOutAction={signOutAction}
          showBottomNav
          tools={tools}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
