"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  SESSION_WATCH_POLL_MS,
  shouldKickForReplacedSession,
} from "@/lib/auth/session-watch";

// Polling companion to requireUser() Layer 1 (docs/permissions.md).
// VPS production does not run Supabase Realtime.
export function SessionWatch({ userId }: { userId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data: mySessionId } = await supabase.rpc("current_session_id");
      if (cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("active_session_id")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;

      const activeSessionId =
        (profile?.active_session_id as string | null | undefined) ?? null;
      if (
        !shouldKickForReplacedSession({
          mySessionId: mySessionId as string | null,
          activeSessionId,
        })
      ) {
        return;
      }

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
  }, [supabase, userId, router]);

  return null;
}
