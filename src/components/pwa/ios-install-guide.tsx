"use client";

import { Share, PlusSquare, Check, Globe } from "lucide-react";

export function IosInstallGuide() {
  const steps = [
    {
      n: "1",
      title: "Open MedVerse in Safari",
      body: "Home Screen install on iPhone and iPad works from Safari, not Chrome or in-app browsers. There is no App Store download.",
      icon: Globe,
    },
    {
      n: "2",
      title: "Tap Share",
      body: "Use the Share button in Safari (square with an arrow pointing up).",
      icon: Share,
    },
    {
      n: "3",
      title: "Tap Add to Home Screen",
      body: "Scroll the share sheet if needed, then choose Add to Home Screen.",
      icon: PlusSquare,
    },
    {
      n: "4",
      title: "Tap Add",
      body: "Confirm the name MedVerse. This places the MedVerse app on your Home Screen. Open it from there as a web app — not from a browser tab.",
      icon: Check,
    },
  ];

  return (
    <ol className="grid gap-3">
      {steps.map((step) => {
        const Icon = step.icon;
        return (
          <li
            key={step.n}
            className="flex gap-3 rounded-xl border border-border/80 bg-[var(--student-canvas)] p-3"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#072855] text-sm font-semibold text-white"
              aria-hidden
            >
              {step.n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--student-ink)]">
                <Icon className="size-4 shrink-0 text-[var(--brand-teal-ink)]" aria-hidden />
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
