import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAuthCookieOptions } from "@/lib/supabase/auth-cookie-options";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";

// When SUPABASE_DIRECT_URL is set, rewrite server-side auth calls to bypass
// the Cloudflare proxy loopback (VPS cannot reach itself via Cloudflare on
// /auth/v1/* without a 522). PostgREST calls are unaffected and still route
// through the local PostgREST instance via the Caddy proxy.
function makeServerFetch(): typeof fetch {
  const directUrl = process.env.SUPABASE_DIRECT_URL;
  const proxyUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!directUrl || !proxyUrl) return supabaseFetch;
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(proxyUrl + "/auth/")) {
      const rewritten = directUrl + url.slice(proxyUrl.length);
      input =
        typeof input === "string"
          ? rewritten
          : input instanceof URL
            ? new URL(rewritten)
            : new Request(rewritten, input);
    }
    return supabaseFetch(input, init);
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
