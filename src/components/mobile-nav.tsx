"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Menu,
  LayoutDashboard,
  BookOpen,
  PencilLine,
  ClipboardList,
  BarChart3,
  UserRound,
  Users,
  Database,
  FolderOpen,
  History,
  CreditCard,
  Shield,
  Gift,
  Sparkles,
  Lock,
  FileText,
  Stethoscope,
  Clapperboard,
  Library,
  StickyNote,
  Video,
  Phone,
  GraduationCap,
  Award,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { BrandCredit } from "@/components/brand-credit";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";

// Icon components can't cross the Server -> Client Component boundary as
// props (only plain data can), so layout.tsx files pass an icon *key* and
// this client-only registry resolves it to the actual component.
export const ICONS = {
  dashboard: LayoutDashboard,
  materials: BookOpen,
  practice: PencilLine,
  tests: ClipboardList,
  performance: BarChart3,
  account: UserRound,
  subscription: CreditCard,
  freeResources: Gift,
  pearlPoints: Sparkles,
  students: Users,
  admins: Shield,
  curriculum: BookOpen,
  questions: Database,
  materialsFolder: FolderOpen,
  auditLog: History,
  guidelines: FileText,
  ospeMaterial: Stethoscope,
  ospeLectures: Clapperboard,
  books: Library,
  notes: StickyNote,
  lectures: Video,
  contact: Phone,
  career: GraduationCap,
  imd: Award,
  classLibrary: FolderOpen,
} as const;

export type IconKey = keyof typeof ICONS;

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
  /** Paid LMS section locked for free / expired / pending students. */
  locked?: boolean;
};

// Exact-match roots (e.g. "/admin", "/dashboard") only highlight on an exact
// path match; every other href also matches its own sub-routes.
export function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/admin" || href === "/dashboard") return false;
  return pathname.startsWith(href + "/");
}

export function MobileNav({
  navItems,
  bottomItems,
  userLabel,
  subLabel,
  signOutAction,
  showBottomNav = false,
}: {
  /** Full list shown in the slide-out drawer. */
  navItems: NavItem[];
  /** Optional primary links for student bottom tab bar (max ~4). */
  bottomItems?: NavItem[];
  userLabel: string;
  subLabel: string;
  signOutAction: () => Promise<void>;
  /** Student may keep a compact bottom bar; Admin must not. */
  showBottomNav?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = showBottomNav ? (bottomItems ?? []).slice(0, 4) : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Policy: hamburger LEFT, MedVerse logo RIGHT */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden">
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="size-10 shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <Logo size={26} className="min-w-0" />
      </header>

      <SheetContent
        side="left"
        showCloseButton
        className="flex w-[min(20rem,88vw)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="shrink-0 border-b border-sidebar-border px-4 py-4 text-left">
          <SheetTitle className="text-sidebar-foreground">
            <Logo size={24} />
          </SheetTitle>
          <div className="mt-2 truncate text-sm font-medium text-sidebar-foreground/90">
            {userLabel}
          </div>
          <div className="truncate text-xs text-sidebar-foreground/55">
            {subLabel}
          </div>
        </SheetHeader>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-3">
          {navItems.map((item) => {
            const Icon = ICONS[item.icon];
            const active = !item.locked && isActivePath(pathname, item.href);
            return (
              <SheetClose asChild key={item.href}>
                <Link
                  href={item.href}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                    item.locked
                      ? "text-sidebar-foreground/55 hover:bg-sidebar-accent/50"
                      : active
                        ? "bg-sidebar-accent font-medium text-white shadow-[inset_3px_0_0_0_var(--brand-teal)]"
                        : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0 opacity-90" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.locked ? (
                    <Lock
                      className="size-3.5 shrink-0 opacity-70"
                      aria-label="Locked"
                    />
                  ) : null}
                </Link>
              </SheetClose>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <InstallMedverseApp variant="nav" />
          <form action={signOutAction}>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              className="h-10 w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Sign out
            </Button>
          </form>
          <BrandCredit tone="sidebar" />
        </div>
      </SheetContent>

      {tabs.length > 0 ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur-md md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Primary"
        >
          {tabs.map((item) => {
            const Icon = ICONS[item.icon];
            const active = !item.locked && isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] sm:text-[11px] ${
                  item.locked
                    ? "text-sidebar-foreground/45"
                    : active
                      ? "font-medium text-sidebar-primary"
                      : "text-sidebar-foreground/70"
                }`}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {item.locked ? (
                    <Lock
                      className="absolute -right-1.5 -top-0.5 size-2.5"
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </Sheet>
  );
}
