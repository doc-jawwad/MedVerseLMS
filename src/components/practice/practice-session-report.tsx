"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatReportDuration } from "@/lib/practice/timer";
import type { PracticeSessionReport } from "@/lib/practice/types";

export function PracticeSessionReportCard({
  title,
  report,
  backHref,
  backLabel = "Back",
  variant = "mcq",
}: {
  title: string;
  report: PracticeSessionReport;
  backHref: string;
  backLabel?: string;
  variant?: "mcq" | "pearl";
}) {
  return (
    <div
      className="mx-auto grid w-full max-w-lg gap-6 rounded-3xl border border-[#072855]/10 bg-gradient-to-b from-white to-[#072855]/[0.03] p-6 shadow-none sm:p-8"
      data-testid="practice-session-report"
    >
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#05AEA9] uppercase">
          Session report
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-[#072855]">
          {title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Nice work — here is what you covered this session.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Stat
          label={variant === "mcq" ? "MCQs practiced" : "Items practiced"}
          value={String(report.totalPracticed)}
        />
        <Stat label="Time taken" value={formatReportDuration(report.timeTakenMs)} />
        {variant === "mcq" ? (
          <>
            <Stat label="Correct" value={String(report.correct)} />
            <Stat label="Accuracy" value={`${report.accuracyPercent}%`} />
          </>
        ) : (
          <Stat
            label="Session focus"
            value={report.totalPracticed > 0 ? "Complete" : "—"}
            className="col-span-2"
          />
        )}
      </dl>

      <Button asChild className="w-full sm:w-fit">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-[#072855]/[0.04] px-4 py-3 ${className ?? ""}`}
    >
      <dt className="text-[11px] font-semibold tracking-wide text-[#072855]/55 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-heading text-xl font-semibold tabular-nums text-[#072855]">
        {value}
      </dd>
    </div>
  );
}
