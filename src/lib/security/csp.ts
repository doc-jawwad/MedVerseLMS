/**
 * Content Security Policy for MedVerse LMS.
 *
 * Origins are derived from audited runtime deps (same-origin Auth/PostgREST,
 * Sentry ingest, R2 direct upload, YouTube embeds, pdf.js worker, next-themes).
 * Do not tighten below what the inventory requires.
 *
 * Mode (runtime, via MEDVERSE_CSP_MODE):
 * - report-only (default) — Content-Security-Policy-Report-Only
 * - enforce — Content-Security-Policy
 * - off — no CSP response header
 */

export type CspMode = "off" | "report-only" | "enforce";

export type BuildCspOptions = {
  nonce: string;
  isDev?: boolean;
  /** Full Sentry DSN or blank when unset. */
  sentryDsn?: string;
  /** Optional R2_ENDPOINT override host allowlist. */
  r2Endpoint?: string;
  mode?: CspMode;
};

const SENTRY_HOST_FALLBACKS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.de.sentry.io",
] as const;

const R2_HOST_FALLBACK = "https://*.r2.cloudflarestorage.com";

export function resolveCspMode(
  raw: string | undefined = process.env.MEDVERSE_CSP_MODE
): CspMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "enforce" || v === "enforced") return "enforce";
  if (v === "off" || v === "disabled" || v === "0") return "off";
  // Default: report-only so staging can validate before flipping to enforce.
  return "report-only";
}

export function extractSentryIngestOrigin(dsn: string | undefined): string | null {
  const trimmed = (dsn ?? "").trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function extractR2ConnectOrigin(endpoint: string | undefined): string | null {
  const trimmed = (endpoint ?? "").trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Build the CSP header value (directives only, no header name).
 * The same value is placed on the request (for Next nonce extraction) and
 * optionally on the response as enforce or report-only.
 */
export function buildCspHeaderValue(options: BuildCspOptions): string {
  const isDev = options.isDev ?? process.env.NODE_ENV === "development";
  const nonce = options.nonce;
  if (!nonce) throw new Error("csp_nonce_required");

  const connect = new Set<string>(["'self'", R2_HOST_FALLBACK, ...SENTRY_HOST_FALLBACKS]);
  const sentryOrigin = extractSentryIngestOrigin(
    options.sentryDsn ??
      process.env.NEXT_PUBLIC_SENTRY_DSN ??
      process.env.SENTRY_DSN
  );
  if (sentryOrigin) connect.add(sentryOrigin);

  const r2Origin = extractR2ConnectOrigin(
    options.r2Endpoint ?? process.env.R2_ENDPOINT
  );
  if (r2Origin) connect.add(r2Origin);

  // script-src: nonce + strict-dynamic (Next attaches nonce to framework scripts).
  // 'unsafe-eval' only in development (React Refresh / stack reconstruction).
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  // style-src-elem: nonced Next/Geist styles. style-src-attr: React style={{}}.
  // (A lone style-src nonce ignores 'unsafe-inline' and breaks style attributes.)
  const styleSrcElem = `'self' 'nonce-${nonce}'`;
  const styleSrcAttr = "'unsafe-inline'";

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrcElem}`,
    `style-src-elem ${styleSrcElem}`,
    `style-src-attr ${styleSrcAttr}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${[...connect].join(" ")}`,
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ").replace(/\s{2,}/g, " ").trim();
}

export function cspResponseHeaderName(mode: CspMode): string | null {
  if (mode === "off") return null;
  if (mode === "enforce") return "Content-Security-Policy";
  return "Content-Security-Policy-Report-Only";
}

/** Apply CSP to a NextResponse based on MEDVERSE_CSP_MODE. */
export function applyCspToResponse(
  response: { headers: { set: (k: string, v: string) => void; delete: (k: string) => void } },
  cspValue: string,
  mode: CspMode = resolveCspMode()
): void {
  // Clear both so flipping modes does not leave a stale twin header.
  response.headers.delete("Content-Security-Policy");
  response.headers.delete("Content-Security-Policy-Report-Only");
  const name = cspResponseHeaderName(mode);
  if (name) response.headers.set(name, cspValue);
}
