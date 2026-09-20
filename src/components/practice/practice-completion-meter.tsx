"use client";

import { Progress } from "@/components/ui/progress";

export function PracticeCompletionMeter({
  percent,
  label = "Folder complete",
}: {
  percent: number;
  label?: string;
}) {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-[#072855]/70">{label}</span>
        <span className="tabular-nums font-semibold text-[#072855]">{safe}%</span>
      </div>
      <Progress value={safe} className="h-1.5 bg-[#072855]/10" />
    </div>
  );
}
