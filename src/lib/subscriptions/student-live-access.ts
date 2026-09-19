import "server-only";

import { cache } from "react";
import { requireStudent } from "@/lib/auth/require-user";
import { ssrSpan } from "@/lib/observability/ssr-timing-rsc";

/** Deduped with layout + page renders in the same RSC request. */
export const getStudentHasLiveSubscription = cache(async function getStudentHasLiveSubscription() {
  const { supabase } = await requireStudent();
  const { data } = await ssrSpan("rpc.has_live_subscription", () =>
    supabase.rpc("has_live_subscription")
  );
  return Boolean(data);
});
