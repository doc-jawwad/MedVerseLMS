"use client";

import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { AcademicTreeSurface } from "@/lib/academic-tree";

/** Desktop sidebar tools: search + theme. */
export function ShellTools({
  surface,
  yearId,
  yearNumber,
  yearName,
  hasLiveSubscription,
  showSearch = true,
}: {
  surface: AcademicTreeSurface;
  yearId: string;
  yearNumber: number;
  yearName: string;
  hasLiveSubscription: boolean;
  showSearch?: boolean;
}) {
  return (
    <div className="space-y-2">
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
