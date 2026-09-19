"use client";

import { useState } from "react";
import { Check, Download } from "lucide-react";
import { usePwaInstall } from "@/components/pwa/pwa-runtime-provider";
import { IosInstallGuide } from "@/components/pwa/ios-install-guide";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { shouldShowDashboardInstallCard } from "@/lib/pwa/install";

type Variant = "button" | "card" | "nav";

export function InstallMedverseApp({
  variant = "button",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const { state, promptInstall, standalone } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  if (state === "hidden") return null;
  if (variant === "card" && !shouldShowDashboardInstallCard(state)) {
    return null;
  }

  const installed = state === "installed" || standalone;
  const label = installed ? "Installed" : "Install MedVerse App";

  async function onInstall() {
    if (installed) return;
    if (state === "android-install") {
      const outcome = await promptInstall();
      if (outcome === "unavailable") setFallbackOpen(true);
      return;
    }
    if (state === "ios-guide") {
      setGuideOpen(true);
      return;
    }
    setFallbackOpen(true);
  }

  const action = (
    <Button
      type="button"
      variant={variant === "nav" ? "outline" : installed ? "secondary" : "default"}
      size={variant === "nav" ? "sm" : "lg"}
      className={cn(
        variant === "nav" &&
          "h-10 w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        variant === "button" && "h-10 min-h-11 w-full sm:w-auto",
        variant === "card" && "h-10 min-h-11 w-full sm:w-auto",
        className
      )}
      onClick={() => void onInstall()}
      disabled={installed}
      aria-label={label}
      data-testid="install-medverse-app"
      data-install-state={state}
    >
      {installed ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {label}
    </Button>
  );

  const body = (
    <>
      {variant === "card" ? (
        <div className="rounded-xl border border-border/80 bg-card p-4 shadow-none">
          <p className="text-sm font-semibold text-[#072855]">
            Use MedVerse as an app
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Install on your phone for a full-screen Home Screen shortcut. This
            does not change your account, subscription, or exam rules.
          </p>
          <div className="mt-3">{action}</div>
        </div>
      ) : (
        action
      )}

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent
          className="max-h-[min(36rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-md"
          aria-describedby="ios-install-desc"
        >
          <DialogHeader>
            <DialogTitle>Install on iPhone</DialogTitle>
            <DialogDescription id="ios-install-desc">
              Add MedVerse to your Home Screen. This creates the MedVerse app
              icon — it is not an App Store download.
            </DialogDescription>
          </DialogHeader>
          <IosInstallGuide />
          <DialogFooter showCloseButton>
            <p className="mr-auto text-[11px] text-muted-foreground sm:self-center">
              Share → Add to Home Screen → Open as Web App → Add
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fallbackOpen} onOpenChange={setFallbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install MedVerse</DialogTitle>
            <DialogDescription>
              This browser does not expose a one-tap install prompt. Use the
              browser menu: look for <strong>Install app</strong> or{" "}
              <strong>Add to Home Screen</strong>. On iPhone, open MedVerse in
              Safari and use Share → Add to Home Screen → Add. MedVerse is not
              distributed on the App Store.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );

  return body;
}
