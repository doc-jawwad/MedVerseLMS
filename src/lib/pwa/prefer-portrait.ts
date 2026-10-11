/**
 * Prefer portrait for installed PWA / exam surfaces.
 * CSS cannot prevent physical rotation; Screen Orientation API may reject.
 */

export function canUseOrientationLock(): boolean {
  if (typeof screen === "undefined") return false;
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    return typeof orientation?.lock === "function";
  } catch {
    return false;
  }
}

/** Best-effort portrait lock. Never throws; never blocks the caller. */
export async function tryLockPortraitOrientation(): Promise<boolean> {
  if (!canUseOrientationLock()) return false;
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock: (orientation: string) => Promise<void>;
    };
    await orientation.lock("portrait");
    return true;
  } catch {
    return false;
  }
}

/** Release a prior lock when supported. Safe no-op on failure. */
export async function tryUnlockOrientation(): Promise<void> {
  if (typeof screen === "undefined") return;
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      unlock?: () => void;
    };
    orientation.unlock?.();
  } catch {
    /* ignore */
  }
}
