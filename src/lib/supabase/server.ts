import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookie-options";
import {
  createInternalRestFetch,
  supabaseFetch,
} from "@/lib/supabase/postgrest-fetch";

// Server-side routing (browser-facing URL is unchanged):
// - SUPABASE_DIRECT_URL: /auth/ bypasses the Cloudflare loopback (522 on the VPS).
// - POSTGREST_INTERNAL_URL: /rest/v1 goes straight to loopback PostgREST instead
//   of hairpinning Cloudflare -> Caddy -> PostgREST. Same JWT + RLS; no-op if unset.
function makeServerFetch(): typeof fetch {
  const directUrl = process.env.SUPABASE_DIRECT_URL;
  const proxyUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const internalRest = process.env.POSTGREST_INTERNAL_URL;
  if (!proxyUrl || (!directUrl && !internalRest)) return supabaseFetch;
  const restFetch = createInternalRestFetch(proxyUrl, internalRest);
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (directUrl && url.startsWith(proxyUrl + "/auth/")) {
      const rewritten = directUrl + url.slice(proxyUrl.length);
      input =
        typeof input === "string"
          ? rewritten
          : input instanceof URL
            ? new URL(rewritten)
            : new Request(rewritten, input);
    }
    // Auth (rewritten above or not) and everything non-REST pass through;
    // /rest/v1 is sent to loopback PostgREST when POSTGREST_INTERNAL_URL is set.
    return restFetch(input, init);
  };
}

const serverFetch = makeServerFetch();

// Server Components / Server Actions / Route Handlers client.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: serverFetch },
      cookieOptions: supabaseAuthCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component: session refresh is handled by proxy.ts.
          }
        },
      },
    }
  );
}
