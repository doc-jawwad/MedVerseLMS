export { cn } from "cn";

// Pinned locale + timeZone so server-rendered HTML and the client's
// hydration pass always produce the identical string, regardless of the
// machine's OS locale/timezone. Using the bare `.toLocaleString()` (which
// defaults to the runtime's locale) caused a real React hydration mismatch:
// Node's server-side default locale formatted a timestamp differently than
// the browser's locale did on the client.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

export function formatDateTime(value: string | number | Date): string {
  return DATE_TIME_FORMAT.format(new Date(value));
}

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string | number | Date): string {
  return DATE_ONLY_FORMAT.format(new Date(value));
}
