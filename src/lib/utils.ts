export { cn } from "cn";

/** Canonical user-facing timezone: Pakistan Standard Time (not US Pacific). */
export const APP_DISPLAY_TIMEZONE = "Asia/Karachi";

// Pinned locale + IANA zone so SSR HTML and client hydration match, while
// presenting academy-local Pakistan time (UTC+05:00) instead of raw UTC.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: APP_DISPLAY_TIMEZONE,
});

export function formatDateTime(value: string | number | Date): string {
  return DATE_TIME_FORMAT.format(new Date(value));
}

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: APP_DISPLAY_TIMEZONE,
});

export function formatDate(value: string | number | Date): string {
  return DATE_ONLY_FORMAT.format(new Date(value));
}
