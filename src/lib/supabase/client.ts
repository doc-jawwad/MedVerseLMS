"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: supabaseFetch },
    }
  );
}
