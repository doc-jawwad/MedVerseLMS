"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ICONS, isActivePath, type NavItem } from "@/components/mobile-nav";

/** Desktop sidebar nav shared by student + admin shells. */
export function ShellNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
      {items.map((item) => (
        <ShellNavEntry key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function NavPendingMark() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      className="size-3.5 shrink-0 animate-spin text-[var(--brand-teal)]"
      aria-label="Loading"
    />
  );
}

function ShellNavEntry({
  item,
  pathname,
  depth = 0,
}: {
  item: NavItem;
  pathname: string;
  depth?: number;
}) {
  const Icon = ICONS[item.icon];
  const active = !item.locked && isActivePath(pathname, item.href);
  const pad = depth > 0 ? "pl-7" : "";

  return (
    <div className="flex flex-col gap-0.5">
      <Link
        href={item.href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${pad} ${
          item.locked
            ? "text-[var(--sidebar-muted)] hover:bg-sidebar-accent/50"
            : active
              ? "bg-sidebar-accent font-medium text-white shadow-[inset_3px_0_0_0_var(--brand-teal)]"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon className="size-4 shrink-0 opacity-90" />
        <span className="flex-1 truncate">{item.label}</span>
        <NavPendingMark />
        {item.locked ? (
          <span className="text-[10px] tracking-wide text-sidebar-foreground/50 uppercase">
            locked
          </span>
        ) : null}
      </Link>
      {item.children?.map((child) => (
        <ShellNavEntry
          key={child.href}
          item={child}
          pathname={pathname}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
