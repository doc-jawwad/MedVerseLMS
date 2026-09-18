export function livenessBody() {
  return { ok: true as const, service: "medverse-lms" };
}

export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.replace(/^\[/, "").replace(/\]$/, "").replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

export function isLoopbackHost(host: string | undefined | null): boolean {
  if (!host) return false;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 1 && host.slice(1, end) === "::1";
  }
  const h = host.split(":")[0];
  return h === "127.0.0.1" || h === "localhost";
}

/**
 * Ready checks are not a public monitor.
 * Allow: Bearer $CRON_SECRET, or a direct loopback request to Next (no
 * X-Forwarded-For — Caddy always sets that header for public clients).
 * Never treat X-Forwarded-For as proof of localhost.
 */
export function authorizeReady(opts: {
  ip?: string | null;
  host?: string | null;
  xForwardedFor?: string | null;
  authorization?: string | null;
  cronSecret?: string | undefined;
}): boolean {
  const secret = opts.cronSecret;
  if (secret && (opts.authorization ?? "") === `Bearer ${secret}`) {
    return true;
  }
  if (!opts.xForwardedFor && isLoopbackHost(opts.host)) {
    return true;
  }
  if (isLoopbackAddress(opts.ip)) {
    return true;
  }
  return false;
}

export function postgrestProbeUrl(opts: {
  internalUrl?: string | undefined;
  publicSupabaseUrl?: string | undefined;
}): string | null {
  const internal = opts.internalUrl?.trim();
  if (internal) return internal.replace(/\/$/, "");
  const pub = opts.publicSupabaseUrl?.trim();
  if (pub) return `${pub.replace(/\/$/, "")}/rest/v1/`;
  return null;
}
