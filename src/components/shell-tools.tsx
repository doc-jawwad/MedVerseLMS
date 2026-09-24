"use client";

import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { AcademicTreeSurface } from "@/lib/academic-tree";
import { cn } from "@/lib/utils";

type ShellToolsProps = {
  surface: AcademicTreeSurface;
  yearId: string;
  yearNumber: number;
  yearName: string;
  hasLiveSubscription: boolean;
  showSearch?: boolean;
  /**
   * `sidebar` — labeled Search row + segmented theme (admin drawer/aside).
   * `header` — compact search icon + Light/Dark icon toggle (student header).
   */
  layout?: "sidebar" | "header";
  className?: string;
};

/** Shell chrome tools: search + theme. */
export function ShellTools({
  surface,
  yearId,
  yearNumber,
  yearName,
  hasLiveSubscription,
  showSearch = true,
  layout = "sidebar",
  className,
}: ShellToolsProps) {
  if (layout === "header") {
    return (
      <div
        className={cn("flex items-center gap-1", className)}
        data-testid="shell-header-tools"
      >
        {showSearch ? (
          <GlobalSearch
            surface={surface}
            yearId={yearId}
            yearNumber={yearNumber}
            yearName={yearName}
            hasLiveSubscription={hasLiveSubscription}
            tone="sidebar"
            className="size-9"
          />
        ) : null}
        <ThemeToggle variant="icon" tone="sidebar" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {showSearch ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] tracking-wide text-[var(--sidebar-muted)] uppercase">
            Search
          </span>
          <GlobalSearch
            surface={surface}
            yearId={yearId}
            yearNumber={yearNumber}
            yearName={yearName}
            hasLiveSubscription={hasLiveSubscription}
            tone="sidebar"
          />
        </div>
      ) : null}
      <ThemeToggle className="w-full" />
    </div>
  );
}
