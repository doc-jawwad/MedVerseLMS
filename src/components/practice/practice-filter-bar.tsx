"use client";

import { cn } from "cn";
import type { PracticeFilter, PracticeFilterCounts } from "@/lib/practice/types";

const FILTERS: { id: PracticeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "remaining", label: "Remaining" },
  { id: "done", label: "Done" },
  { id: "marked", label: "Marked" },
];

export function PracticeFilterBar({
  value,
  counts,
  onChange,
}: {
  value: PracticeFilter;
  counts: PracticeFilterCounts;
  onChange: (filter: PracticeFilter) => void;
}) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Practice filters"
    >
      {FILTERS.map((f) => {
        const active = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors",
              active
                ? "bg-[#072855] text-white"
                : "bg-[#072855]/6 text-[#072855]/80 hover:bg-[#072855]/10"
            )}
          >
            {f.label}
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                active ? "text-white/70" : "text-[#072855]/45"
              )}
            >
              {counts[f.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
