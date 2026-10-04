#!/usr/bin/env node
/**
 * Promote Auth user_metadata.college_name → profiles.college_name for rows
 * that are still blank. Needed on Auth/DB-split hosts where the SQL
 * auth.users backfill in 20261004030000 is a no-op.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_DIRECT_URL for Auth host)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MEDVERSE_ALLOW_CLOUD_STAGING=yes  (staging Auth)
 *   MEDVERSE_ALLOW_PRODUCTION=yes    (production Auth — explicit only)
 *
 * Does not overwrite a non-empty profiles.college_name.
 * Does not touch ranks, scores, attempts, or Auth metadata.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { assertNotCloudProduction } from "./lib/env-guard.mjs";
import { authAdminHeaders } from "./lib/postgrest-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = path.join(__dirname, "..", ".env.local");
  const out = {};
  if (fs.existsSync(p)) {
    const text = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_DIRECT_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MEDVERSE_ALLOW_PRODUCTION",
    "MEDVERSE_ALLOW_CLOUD_STAGING",
  ]) {
    if (process.env[key]) out[key] = process.env[key];
  }
  return out;
}

function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Mirrors src/lib/profile/college-backfill.ts — keep in sync. */
function resolveCollegeBackfill(profileCollege, authCollege) {
  if (nonEmpty(profileCollege)) return null;
  return nonEmpty(authCollege);
}

async function listAuthUsers(authBase, serviceKey) {
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const url = `${authBase}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: authAdminHeaders(serviceKey),
    });
    if (!res.ok) {
      throw new Error(`auth list users failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const batch = Array.isArray(body?.users) ? body.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 500) throw new Error("auth list pagination safety stop");
  }
  return users;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const authBase = (
    env.SUPABASE_DIRECT_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const restBase = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const service = env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!authBase || !restBase || !service) {
    throw new Error(
      "Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (and optional SUPABASE_DIRECT_URL)"
    );
  }

  assertNotCloudProduction(authBase, { allowStaging: true });
  assertNotCloudProduction(restBase, { allowStaging: true });

  const admin = createClient(restBase, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`MODE=${apply ? "APPLY" : "DRY_RUN"}`);
  console.log(`AUTH=${authBase}`);
  console.log(`REST=${restBase}`);

  const authUsers = await listAuthUsers(authBase, service);
  console.log(`AUTH_USERS=${authUsers.length}`);

  let scanned = 0;
  let wouldHeal = 0;
  let healed = 0;
  let skippedHasCollege = 0;
  let skippedNoAuthCollege = 0;
  let missingProfile = 0;
  let errors = 0;

  for (const user of authUsers) {
    scanned += 1;
    const id = user?.id;
    if (!id) continue;
    const authCollege = nonEmpty(user?.user_metadata?.college_name);
    const { data: profile, error: readErr } = await admin
      .from("profiles")
      .select("id, college_name")
      .eq("id", id)
      .maybeSingle();
    if (readErr) {
      errors += 1;
      console.error(`READ_ERR ${id}: ${readErr.message}`);
      continue;
    }
    if (!profile) {
      missingProfile += 1;
      continue;
    }
    const next = resolveCollegeBackfill(profile.college_name, authCollege);
    if (!next) {
      if (nonEmpty(profile.college_name)) skippedHasCollege += 1;
      else skippedNoAuthCollege += 1;
      continue;
    }
    wouldHeal += 1;
    console.log(
      `HEAL ${id} profile=${JSON.stringify(profile.college_name)} -> ${JSON.stringify(next)}`
    );
    if (!apply) continue;

    // Re-read then write only while still blank (never clobber a profile edit).
    const { data: again, error: r2 } = await admin
      .from("profiles")
      .select("college_name")
      .eq("id", id)
      .maybeSingle();
    if (r2) {
      errors += 1;
      console.error(`REREAD_ERR ${id}: ${r2.message}`);
      continue;
    }
    if (resolveCollegeBackfill(again?.college_name, next) == null) {
      skippedHasCollege += 1;
      wouldHeal -= 1;
      continue;
    }
    const { error: updErr } = await admin
      .from("profiles")
      .update({ college_name: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) {
      errors += 1;
      console.error(`UPDATE_ERR ${id}: ${updErr.message}`);
      continue;
    }
    healed += 1;
  }

  console.log(
    JSON.stringify(
      {
        scanned,
        wouldHeal,
        healed: apply ? healed : 0,
        skippedHasCollege,
        skippedNoAuthCollege,
        missingProfile,
        errors,
        apply,
      },
      null,
      2
    )
  );
  if (errors > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
