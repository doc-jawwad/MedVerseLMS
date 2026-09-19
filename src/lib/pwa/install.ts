export type InstallSurfaceState =
  | "hidden"
  | "installed"
  | "android-install"
  | "ios-guide"
  | "fallback";

export type InstallPlatform = "ios" | "android" | "desktop" | "unknown";

export function isStandaloneDisplay(input: {
  displayModeStandalone: boolean;
  iosStandalone: boolean;
  displayModeFullscreen?: boolean;
  displayModeMinimalUi?: boolean;
}): boolean {
  return (
    input.displayModeStandalone ||
    input.iosStandalone ||
    Boolean(input.displayModeFullscreen) ||
    Boolean(input.displayModeMinimalUi)
  );
}

export function detectInstallPlatform(
  userAgent: string,
  maxTouchPoints = 0
): InstallPlatform {
  const ua = userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ often reports as Macintosh.
  if (/Macintosh/i.test(ua) && (maxTouchPoints > 1 || /Mobile/i.test(ua))) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || "";
  if (detectInstallPlatform(ua, maxTouchPoints) !== "ios") return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)) return false;
  return /Safari/i.test(ua) || /AppleWebKit/i.test(ua);
}

export function resolveInstallSurface(input: {
  pathname: string;
  standalone: boolean;
  platform: InstallPlatform;
  canPrompt: boolean;
}): InstallSurfaceState {
  if (isExamLikePath(input.pathname)) return "hidden";
  if (input.standalone) return "installed";
  if (input.platform === "ios") return "ios-guide";
  if (input.canPrompt) return "android-install";
  return "fallback";
}

export function isExamLikePath(pathname: string): boolean {
  return (
    /\/tests\/[^/]+\/attempt(?:\/|$)/.test(pathname) ||
    /\/tests\/[^/]+\/preview(?:\/|$)/.test(pathname)
  );
}

export function shouldShowDashboardInstallCard(
  state: InstallSurfaceState
): boolean {
  return (
    state === "android-install" ||
    state === "ios-guide" ||
    state === "fallback"
  );
}

export const EXAM_ACTIVE_STORAGE_KEY = "medverse_pwa_exam_active";
export const EXAM_ACTIVE_EVENT = "medverse:exam-active";
