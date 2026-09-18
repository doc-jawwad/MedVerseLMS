import { NextResponse } from "next/server";
import { livenessBody } from "@/lib/health";

export const dynamic = "force-dynamic";

// Public process liveness. No database, no config, no secrets (docs/deployment.md).
export async function GET() {
  return NextResponse.json(livenessBody(), {
    headers: { "cache-control": "no-store" },
  });
}
