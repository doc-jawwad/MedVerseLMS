"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { applyServiceWorkerUpdate } from "@/lib/pwa/apply-update";
import { PWA_SW_PATH } from "@/lib/pwa/cache-policy";
import {
  detectInstallPlatform,
  EXAM_ACTIVE_EVENT,
  EXAM_ACTIVE_STORAGE_KEY,
  isExamLikePath,
  isStandaloneDisplay,
  resolveInstallSurface,
  type InstallPlatform,
  type InstallSurfaceState,
} from "@/lib/pwa/install";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaContextValue = {
  state: InstallSurfaceState;
  platform: InstallPlatform;
  standalone: boolean;
  updateReady: boolean;
  examActive: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  applyUpdate: () => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

function readExamActiveFlag(): boolean {
  try {
    return sessionStorage.getItem(EXAM_ACTIVE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function PwaRuntimeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("unknown");
  const [canPrompt, setCanPrompt] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const [examActive, setExamActive] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(detectInstallPlatform(ua, navigator.maxTouchPoints ?? 0));
    const iosStandalone = Boolean(
      (navigator as Navigator & { standalone?: boolean }).standalone
    );
    setStandalone(
      isStandaloneDisplay({
        displayModeStandalone: window.matchMedia(
          "(display-mode: standalone)"
        ).matches,
        displayModeFullscreen: window.matchMedia(
          "(display-mode: fullscreen)"
        ).matches,
        displayModeMinimalUi: window.matchMedia(
          "(display-mode: minimal-ui)"
        ).matches,
        iosStandalone,
      })
    );
    setExamActive(readExamActiveFlag());
  }, []);

  useEffect(() => {
    function onExamActive() {
      setExamActive(readExamActiveFlag());
    }
    window.addEventListener(EXAM_ACTIVE_EVENT, onExamActive);
    return () => window.removeEventListener(EXAM_ACTIVE_EVENT, onExamActive);
  }, []);

  useEffect(() => {
    function onBip(event: Event) {
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setDeferred(promptEvent);
      setCanPrompt(true);
    }
    function onInstalled() {
      setDeferred(null);
      setCanPrompt(false);
      setStandalone(true);
    }
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    function track(reg: ServiceWorkerRegistration) {
      registrationRef.current = reg;
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            // Prefer the real waiting worker (install no longer auto-skipWaiting).
            setWaiting(reg.waiting ?? worker);
          }
        });
      });
    }

    void navigator.serviceWorker
      .register(PWA_SW_PATH, { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        track(reg);
        void reg.update();
      })
      .catch(() => {
        /* registration can fail on insecure origins other than localhost */
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void registrationRef.current?.update();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      void registrationRef.current?.update();
    }, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      setCanPrompt(false);
      return choice.outcome;
    } catch {
      return "unavailable" as const;
    }
  }, [deferred]);

  const applyUpdate = useCallback(() => {
    const reg = registrationRef.current;
    const worker = reg?.waiting ?? waiting;
    setWaiting(null);
    applyServiceWorkerUpdate({
      getWaiting: () => worker ?? reg?.waiting ?? null,
      postSkipWaiting: (sw) => {
        sw.postMessage({ type: "SKIP_WAITING" });
      },
      addControllerChangeListener: (handler) => {
        navigator.serviceWorker.addEventListener("controllerchange", handler);
      },
      removeControllerChangeListener: (handler) => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handler
        );
      },
      reload: () => {
        window.location.reload();
      },
      fallbackMs: 1500,
      schedule: (fn, ms) =>
        setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearSchedule: (id) => clearTimeout(id as unknown as number),
    });
  }, [waiting]);

  const examChrome = isExamLikePath(pathname) || examActive;
  const state = resolveInstallSurface({
    pathname,
    standalone,
    platform,
    canPrompt,
    examActive: examChrome,
  });

  const value = useMemo(
    () => ({
      state,
      platform,
      standalone,
      updateReady: Boolean(waiting) && !examChrome,
      examActive: examChrome,
      promptInstall,
      applyUpdate,
    }),
    [
      state,
      platform,
      standalone,
      waiting,
      examChrome,
      promptInstall,
      applyUpdate,
    ]
  );

  return (
    <PwaContext.Provider value={value}>{children}</PwaContext.Provider>
  );
}

export function usePwaInstall(): PwaContextValue {
  const ctx = useContext(PwaContext);
  if (!ctx) {
    return {
      state: "hidden",
      platform: "unknown",
      standalone: false,
      updateReady: false,
      examActive: false,
      promptInstall: async () => "unavailable",
      applyUpdate: () => {},
    };
  }
  return ctx;
}
