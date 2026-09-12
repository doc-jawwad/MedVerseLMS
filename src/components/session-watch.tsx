"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Realtime companion to the middleware/requireUser() session check
// (docs/permissions.md Layer 1). Without this, an evicted session only
// notices at the next full navigation; this catches it immediately.
export function SessionWatch({ userId }: { userId: string }) {
  const router = useRouter();
  // useState's lazy initializer (not useRef(createClient()).current) —
  // guaranteed by React to run exactly once per mount, so the client isn't
  // constructed and thrown away on every render.
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data: mySessionId } = await supabase.rpc("current_session_id");
      if (cancelled) return;

      channel = supabase
        .channel(`profile-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          async (payload) => {
            const newActive = (payload.new as { active_session_id: string | null })
              .active_session_id;
            if (newActive && newActive !== mySessionId) {
              // Exam-session exemption: don't kick a tab mid-attempt.
              const { data: exempt } = await supabase.rpc(
                "owns_live_attempt_session"
              );
              if (exempt) return;
              await supabase.auth.signOut({ scope: "local" });
              router.replace("/login?reason=kicked");
            }
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, userId, router]);

  return null;
}
