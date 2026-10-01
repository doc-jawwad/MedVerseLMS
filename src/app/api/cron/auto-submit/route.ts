import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/cron/assert-cron-auth";
import { reportServerException } from "@/lib/observability/report-server-exception";
import { createAdminClient } from "@/lib/supabase/admin";
import { isJwt } from "@/lib/supabase/postgrest-fetch";

// HTTP backup for pg_cron (docs/deployment.md). Finalizes attempts past
// expires_at + 60s. Guarded by CRON_SECRET (fail-closed if unset/empty).
//
// VPS: pg_cron is primary. This route only calls PostgREST when
// SUPABASE_SERVICE_ROLE_KEY is a JWT (managed Supabase / Vercel). Opaque
// sb_secret_* keys are Auth API keys, not PostgREST credentials.
export async function GET(request: NextRequest) {
  const cronAuth = assertCronAuthorized(request.headers.get("authorization"));
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!isJwt(serviceKey)) {
    return NextResponse.json(
      { error: "service_role_jwt_required" },
      { status: 503 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("auto_submit_expired");
  if (error) {
    console.error("auto_submit_expired failed", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    reportServerException("cron.auto_submit_expired", error, {
      code: error.code ?? null,
    });
    return NextResponse.json({ error: "auto_submit_failed" }, { status: 500 });
  }
  return NextResponse.json({ finalized: data ?? 0 });
}
