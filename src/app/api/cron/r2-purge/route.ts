import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isJwt } from "@/lib/supabase/postgrest-fetch";
import {
  createDefaultR2Delete,
} from "@/lib/r2/purge-worker-delete";
import {
  processR2PurgeBatch,
  type R2PurgeQueueRow,
} from "@/lib/r2/purge-worker";

/**
 * R2 purge queue consumer (docs/database.md Content bin).
 * Claims via claim_r2_purge_batch, deletes private study-content/ objects,
 * completes via complete_r2_purge. Guarded by CRON_SECRET.
 *
 * PostgREST path requires a JWT service role (managed Supabase). On VPS with
 * opaque sb_secret_* keys, prefer deploy/scripts/r2-purge-once.sh (local SQL).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "cron_secret_unconfigured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!isJwt(serviceKey)) {
    return NextResponse.json(
      { error: "service_role_jwt_required" },
      { status: 503 }
    );
  }

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
  }

  const supabase = createAdminClient();

  async function isObjectKeyStillReferenced(objectKey: string): Promise<boolean> {
    const mat = await supabase
      .from("materials")
      .select("id", { count: "exact", head: true })
      .or(
        `r2_object_key.eq.${objectKey},cover_object_key.eq.${objectKey}`
      );
    if (mat.error) throw new Error(mat.error.message || "ref_check_materials");
    if ((mat.count ?? 0) > 0) return true;

    const ospe = await supabase
      .from("ospe_stations")
      .select("id", { count: "exact", head: true })
      .eq("r2_object_key", objectKey);
    if (ospe.error) throw new Error(ospe.error.message || "ref_check_ospe");
    if ((ospe.count ?? 0) > 0) return true;

    const pearl = await supabase
      .from("pearl_points")
      .select("id", { count: "exact", head: true })
      .eq("r2_object_key", objectKey);
    if (pearl.error) throw new Error(pearl.error.message || "ref_check_pearl");
    if ((pearl.count ?? 0) > 0) return true;

    const avatar = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("avatar_object_key", objectKey);
    if (avatar.error) throw new Error(avatar.error.message || "ref_check_avatar");
    if ((avatar.count ?? 0) > 0) return true;

    const proof = await supabase
      .from("subscription_applications")
      .select("id", { count: "exact", head: true })
      .eq("screenshot_object_key", objectKey);
    if (proof.error) throw new Error(proof.error.message || "ref_check_payment_proof");
    return (proof.count ?? 0) > 0;
  }

  try {
    const result = await processR2PurgeBatch(
      {
        claimBatch: async (batchLimit) => {
          const { data, error } = await supabase.rpc("claim_r2_purge_batch", {
            p_limit: batchLimit,
          });
          if (error) throw new Error(error.message || "claim_failed");
          return (data ?? []) as R2PurgeQueueRow[];
        },
        complete: async (id, errorText) => {
          const { error } = await supabase.rpc("complete_r2_purge", {
            p_id: id,
            p_error: errorText ?? null,
          });
          if (error) throw new Error(error.message || "complete_failed");
        },
        isObjectKeyStillReferenced,
        deleteObject: createDefaultR2Delete(),
      },
      { limit }
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("r2_purge_batch failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "r2_purge_failed" }, { status: 500 });
  }
}
