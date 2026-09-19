"use client";

import { useEffect } from "react";
import {
  EXAM_ACTIVE_EVENT,
  EXAM_ACTIVE_STORAGE_KEY,
} from "@/lib/pwa/install";

/** Marks an in-progress exam so PWA updates never reload the player. */
export function ExamPwaGuard() {
  useEffect(() => {
    try {
      sessionStorage.setItem(EXAM_ACTIVE_STORAGE_KEY, "1");
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event(EXAM_ACTIVE_EVENT));
    return () => {
      try {
        sessionStorage.removeItem(EXAM_ACTIVE_STORAGE_KEY);
      } catch {
        /* private mode */
      }
      window.dispatchEvent(new Event(EXAM_ACTIVE_EVENT));
    };
  }, []);
  return null;
}
