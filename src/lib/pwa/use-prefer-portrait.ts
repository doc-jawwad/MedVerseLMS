"use client";

import { useEffect } from "react";
import {
  tryLockPortraitOrientation,
  tryUnlockOrientation,
} from "@/lib/pwa/prefer-portrait";

/**
 * Prefer portrait while this component tree is mounted (exam / practice).
 * Unsupported or rejected locks are ignored — answering/submitting stays available.
 */
export function usePreferPortrait(): void {
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!active) return;
      await tryLockPortraitOrientation();
    })();
    return () => {
      active = false;
      void tryUnlockOrientation();
    };
  }, []);
}
