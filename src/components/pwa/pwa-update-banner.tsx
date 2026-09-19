"use client";

import { usePwaInstall } from "@/components/pwa/pwa-runtime-provider";
import { Button } from "@/components/ui/button";

export function PwaUpdateBanner() {
  const { updateReady, applyUpdate, examActive } = usePwaInstall();
  if (!updateReady || examActive) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3"
      style={{
        bottom: "calc(4.75rem + env(safe-area-inset-bottom))",
      }}
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar px-3 py-2 text-sidebar-foreground shadow-lg md:bottom-4">
        <p className="min-w-0 flex-1 text-xs sm:text-sm">
          A MedVerse update is ready. It will not run during an active test.
        </p>
        <Button size="sm" type="button" onClick={applyUpdate}>
          Update now
        </Button>
      </div>
    </div>
  );
}
