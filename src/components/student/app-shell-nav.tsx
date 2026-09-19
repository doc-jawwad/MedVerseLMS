"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { ICONS, isActivePath, type NavItem } from "@/components/mobile-nav";

export function AppShellNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = !item.locked && isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              item.locked
                ? "text-sidebar-foreground/55 hover:bg-sidebar-accent/50"
                : active
                  ? "bg-sidebar-accent font-medium text-white shadow-[inset_3px_0_0_0_#05AEA9]"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0 opacity-90" />
            <span className="flex-1">{item.label}</span>
            {item.locked ? (
              <Lock
                className="size-3.5 shrink-0 opacity-70"
                aria-label="Locked"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
