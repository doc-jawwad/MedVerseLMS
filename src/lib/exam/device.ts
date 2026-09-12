"use client";

const KEY = "medverse_device_id";

// Stable per-browser device id (docs/exam-state-machine.md client protocol).
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // storage unavailable (rare): fall back to a per-load id
    return crypto.randomUUID();
  }
}
