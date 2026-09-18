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
