/**
 * supabase-js sends the constructor key as both `apikey` and, when there is
 * no session, `Authorization: Bearer`. Cloud Auth accepts opaque `sb_*` API
 * keys. VPS PostgREST only accepts a real JWT (or no Authorization → anon).
 * Wrap fetch so `/rest/v1` never gets a non-JWT Bearer. `/auth/v1` is unchanged.
 */

export function isJwt(token: string): boolean {
  const parts = token.split(".");
  return (
    parts.length === 3 &&
    parts[0].startsWith("eyJ") &&
    parts.every((part) => part.length > 0)
  );
}

export function isPostgrestRequestUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === "/rest/v1" || pathname.startsWith("/rest/v1/");
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function stripNonJwtPostgrestAuthorization(headers: Headers): Headers {
  const next = new Headers(headers);
  const auth = next.get("Authorization") ?? next.get("authorization");
  if (!auth) return next;
  const match = /^Bearer\s+(\S+)/i.exec(auth);
  if (!match) return next;
  if (!isJwt(match[1])) {
    next.delete("Authorization");
    next.delete("authorization");
  }
  return next;
}

export function fetchWithoutApiKeyBearerOnPostgrest(
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    if (!isPostgrestRequestUrl(url)) {
      return fetchImpl(input, init);
    }

    const merged = new Headers(
      input instanceof Request ? input.headers : undefined
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => merged.set(key, value));
    }
    const headers = stripNonJwtPostgrestAuthorization(merged);

    if (input instanceof Request) {
      return fetchImpl(new Request(input, { ...init, headers }));
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export const supabaseFetch: typeof fetch =
  fetchWithoutApiKeyBearerOnPostgrest();

/**
 * Server-side only. Rewrites `${publicUrl}/rest/v1/...` to the loopback
 * PostgREST (`POSTGREST_INTERNAL_URL`, e.g. http://127.0.0.1:3001), mirroring
 * Caddy's `uri strip_prefix /rest/v1`. Skips Cloudflare + Caddy so Next.js
 * does not hairpin through the public hostname for every query (504 source in
 * the 2026-11-15 incident). Only /rest/v1 is rewritten: /auth/v1 and storage
 * are untouched. Returns null when not applicable (unset env, other path/host).
 * Authorization/apikey headers are forwarded unchanged, so JWT validation and
 * RLS behave exactly as through Caddy.
 */
export function rewriteRestToInternal(
  url: string,
  publicUrl: string | undefined,
  internalUrl: string | undefined
): string | null {
  const pub = publicUrl?.trim().replace(/\/$/, "");
  const internal = internalUrl?.trim().replace(/\/$/, "");
  if (!pub || !internal) return null;
  const prefix = `${pub}/rest/v1`;
  if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) {
    return null;
  }
  return internal + url.slice(prefix.length);
}

/**
 * fetch that sends /rest/v1 to loopback PostgREST. Order matters: header
 * sanitising (drop non-JWT Bearer) runs against the original public URL, then
 * the URL is rewritten. Non-REST requests pass through to plain fetch.
 */
export function createInternalRestFetch(
  publicUrl: string | undefined,
  internalUrl: string | undefined,
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  if (!publicUrl?.trim() || !internalUrl?.trim()) return supabaseFetch;
  const rewriting: typeof fetch = (input, init) => {
    const rewritten = rewriteRestToInternal(
      requestUrl(input),
      publicUrl,
      internalUrl
    );
    if (!rewritten) return fetchImpl(input, init);
    return fetchImpl(
      input instanceof Request ? new Request(rewritten, input) : rewritten,
      init
    );
  };
  return fetchWithoutApiKeyBearerOnPostgrest(rewriting);
}
