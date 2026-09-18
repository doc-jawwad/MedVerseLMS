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

// Icon components can't cross the Server -> Client Component boundary as
// props (only plain data can), so layout.tsx files pass an icon *key* and
// this client-only registry resolves it to the actual component.
const ICONS = {
  dashboard: LayoutDashboard,
  materials: BookOpen,
  practice: PencilLine,
  tests: ClipboardList,
  performance: BarChart3,
  account: UserRound,
  subscription: CreditCard,
  students: Users,
  curriculum: BookOpen,
  questions: Database,
  materialsFolder: FolderOpen,
  auditLog: History,
} as const;

export type IconKey = keyof typeof ICONS;

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
};

// Exact-match roots (e.g. "/admin", "/dashboard") only highlight on an exact
// path match; every other href also matches its own sub-routes.
function isActivePath(pathname: string, href: string) {
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
}: {
  /** Full list shown in the slide-out drawer. */
  navItems: NavItem[];
  /** Up to 4 primary links pinned to the bottom tab bar; a 5th "More" tab
   * (opening the same drawer) is added automatically. */
  bottomItems: NavItem[];
  userLabel: string;
  subLabel: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <header className="flex items-center justify-between border-b bg-sidebar p-4 text-sidebar-foreground md:hidden">
        <Logo size={24} />
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open menu"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Menu />
          </Button>
        </SheetTrigger>
      </header>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-3/4 max-w-xs flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="border-b border-sidebar-border">
          <SheetTitle className="text-sidebar-foreground">
            <Logo size={22} />
          </SheetTitle>
          <div className="mt-1 text-sm text-sidebar-foreground/80">{userLabel}</div>
          <div className="text-xs text-sidebar-foreground/60">{subLabel}</div>
        </SheetHeader>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActivePath(pathname, item.href);
            return (
              <SheetClose asChild key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </SheetClose>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <form action={signOutAction}>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Sign out
            </Button>
          </form>
        </div>
      </SheetContent>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-sidebar-border bg-sidebar text-sidebar-foreground md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {bottomItems.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? "text-sidebar-primary" : "text-sidebar-foreground/70"
              }`}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-sidebar-foreground/70"
          >
            <Menu className="size-5" />
            More
          </button>
        </SheetTrigger>
      </nav>
    </Sheet>
  );
}
