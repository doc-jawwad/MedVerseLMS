/**
 * Shared Sentry helpers for MedVerse LMS.
 * Runtime capture only — no Session Replay, no default PII.
 * Initializes only when a DSN is set and MEDVERSE_ENV is production or vps-staging.
 */

import type { ErrorEvent } from "@sentry/core";

export type SentryRuntimeTarget = "client" | "server" | "edge";

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|service[_-]?role|cron[_-]?secret|access[_-]?key|private[_-]?key|refresh[_-]?token|sb-.*auth.*)$/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function mapMedverseEnvToSentryEnvironment(
  medverseEnv: string | undefined
): "production" | "staging" | "local" | "unknown" {
  if (medverseEnv === "production") return "production";
  if (medverseEnv === "vps-staging") return "staging";
  if (medverseEnv === "local" || medverseEnv === "loadtest") return "local";
  return "unknown";
}

/** Server/edge: only production + staging hosts with a DSN. */
export function sentryServerEnabled(env = process.env): boolean {
  const medverseEnv = env.MEDVERSE_ENV ?? "";
  if (medverseEnv !== "production" && medverseEnv !== "vps-staging") {
    return false;
  }
  return Boolean(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Client: requires public DSN; environment baked via NEXT_PUBLIC_SENTRY_ENVIRONMENT. */
export function sentryClientEnabled(env = process.env): boolean {
  if (!env.NEXT_PUBLIC_SENTRY_DSN) return false;
  const publicEnv = (env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "").trim();
  return publicEnv === "production" || publicEnv === "staging";
}

export function resolveSentryDsn(env = process.env): string | undefined {
  const dsn = (env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN || "").trim();
  return dsn || undefined;
}

export function resolveSentryEnvironment(env = process.env): string {
  const publicEnv = (env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "").trim();
  if (publicEnv === "production" || publicEnv === "staging") return publicEnv;
  return mapMedverseEnvToSentryEnvironment(env.MEDVERSE_ENV);
}

export function resolveSentryRelease(env = process.env): string | undefined {
  const fromEnv = (
    env.SENTRY_RELEASE ||
    env.NEXT_PUBLIC_SENTRY_RELEASE ||
    ""
  ).trim();
  return fromEnv || undefined;
}

export function scrubSensitiveString(value: string): string {
  return value.replace(EMAIL_RE, "[email]");
}

export function scrubSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return scrubSensitiveString(value);
  if (Array.isArray(value)) return value.map(scrubSensitiveValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[Filtered]";
      } else {
        out[k] = scrubSensitiveValue(v);
      }
    }
    return out;
  }
  return value;
}

/** Drop request bodies / cookies / auth headers from events. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const next: ErrorEvent = { ...event };

  // Never attach end-user identity by default.
  delete next.user;

  if (next.request && typeof next.request === "object") {
    const req = { ...next.request };
    delete req.cookies;
    delete req.data;
    if (req.headers && typeof req.headers === "object") {
      req.headers = scrubSensitiveValue(req.headers) as typeof req.headers;
    }
    if (typeof req.query_string === "string") {
      req.query_string = scrubSensitiveString(req.query_string);
    }
    next.request = req;
  }

  if (next.extra) next.extra = scrubSensitiveValue(next.extra) as typeof next.extra;
  if (next.contexts) {
    next.contexts = scrubSensitiveValue(next.contexts) as typeof next.contexts;
  }

  if (typeof next.message === "string") {
    next.message = scrubSensitiveString(next.message);
  }

  return next;
}

export type SharedSentryInitOptions = {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate: number;
};

/**
 * Conservative defaults for current academy scale.
 * Errors only emphasis: very low trace sampling, no replay/PII.
 */
export function sharedSentryInitOptions(
  target: SentryRuntimeTarget,
  env = process.env
): SharedSentryInitOptions | null {
  const isClient = target === "client";
  const enabled = isClient
    ? sentryClientEnabled(env)
    : sentryServerEnabled(env);
  if (!enabled) return null;

  const dsn = resolveSentryDsn(env);
  if (!dsn) return null;

  const environment = resolveSentryEnvironment(env);
  const release = resolveSentryRelease(env);

  // Staging slightly higher than production; still conservative.
  const tracesSampleRate =
    environment === "staging" ? 0.05 : environment === "production" ? 0.02 : 0;

  return {
    dsn,
    environment,
    ...(release ? { release } : {}),
    tracesSampleRate,
  };
}
