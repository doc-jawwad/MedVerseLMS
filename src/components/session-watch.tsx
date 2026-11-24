"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SESSION_WATCH_POLL_MS } from "@/lib/auth/session-watch";

// Polling companion to requireUser() Layer 1 (docs/permissions.md).
// VPS production does not run Supabase Realtime.
export function SessionWatch() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data: sessionReplaced } = await supabase.rpc("current_session_id", {
        p_require_token_session: true,
      });
      if (cancelled || !sessionReplaced) return;

      const { data: exempt } = await supabase.rpc("owns_live_attempt_session");
      if (cancelled || exempt) return;

      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login?reason=kicked");
    }

    void check();
    const id = window.setInterval(() => {
      void check();
    }, SESSION_WATCH_POLL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") void check();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supabase, router]);

  return null;
}
