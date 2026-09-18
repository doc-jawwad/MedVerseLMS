import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";

// Cloud Auth admin (apikey + Bearer on /auth/v1) and, when the key is a JWT,
// PostgREST service_role. Opaque sb_secret_* keys are never sent as PostgREST
// Bearers — the fetch wrapper strips them from /rest/v1.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch },
    }
  );
}
