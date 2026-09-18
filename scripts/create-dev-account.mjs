#!/usr/bin/env node
// Provisions a confirmed dev/test account via the Supabase Admin API — the
// sanctioned way to create accounts in this project, replacing the old
// "sign up normally as admin@medverse.local" instruction that used to live
// in supabase/seed.sql.
//
// Why this exists: the real self-serve /register flow (a) routes through
// Supabase Auth's own email-format validation, which rejects non-deliverable
// / reserved-use TLDs like `.local` outright (`.local` is an IANA
// special-use domain — RFC 6762 — never a real mailbox), and (b) requires an
// actual confirmation email, which — until a custom SMTP relay is configured
// (see docs/deployment.md "Auth emails") — comes from Supabase's shared
// free-tier mailer, rate-limited to ~2 emails/hour for the whole project.
// Neither of those applies to the Admin API: it creates an already-confirmed
// user directly, no email round-trip, and `.local` addresses work fine
// through it (they always have — only the public signup endpoint's stricter
// validation ever rejected them).
//
// Usage:
//   node scripts/create-dev-account.mjs <email> <password> <full_name> [year_number] [--admin]
//
// Examples:
//   node scripts/create-dev-account.mjs admin@medverse.local "Passw0rd!23" "Dev Admin" --admin
//   node scripts/create-dev-account.mjs student1@medverse.local "Passw0rd!23" "Test Student" 3
//
// Auth Admin API uses SUPABASE_SERVICE_ROLE_KEY (JWT or opaque sb_secret_*).
// PostgREST calls never send opaque sb_secret_* as Authorization Bearer.
// Env comes from the process environment, overlaying .env.local when present.
// Check the target URL before running — this writes real Auth/app rows.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertNotCloudProduction } from "./lib/env-guard.mjs";
import { authAdminHeaders, isJwt, postgrestHeaders } from "./lib/postgrest-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = path.join(__dirname, "..", ".env.local");
  const out = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MEDVERSE_ALLOW_PRODUCTION",
    "MEDVERSE_ALLOW_CLOUD_STAGING",
  ]) {
    if (process.env[key]) out[key] = process.env[key];
  }
  return out;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function main() {
  const [, , email, password, fullName, yearArg, ...rest] = process.argv;
  const makeAdmin = rest.includes("--admin") || yearArg === "--admin";

  if (!email || !password || !fullName) {
    console.error(
      "Usage: node scripts/create-dev-account.mjs <email> <password> <full_name> [year_number] [--admin]"
    );
    process.exit(1);
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters (matches the app's own signup rule).");
  }

  const env = loadEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !serviceKey || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set."
    );
  }

  assertNotCloudProduction(base, { allowStaging: false });

  console.log(`Target project: ${base}`);

  let yearId;
  if (!makeAdmin) {
    const yearNumber = Number(yearArg) || 1;
    const yearRes = await fetch(`${base}/rest/v1/rpc/list_years`, {
      method: "POST",
      headers: postgrestHeaders({ apikey: anonKey }),
      body: "{}",
    });
    const years = await readJson(yearRes);
    const yearRow = Array.isArray(years)
      ? years.find((y) => Number(y.year_number) === yearNumber)
      : null;
    if (!yearRes.ok || !yearRow) {
      const detail = Array.isArray(years) ? `no year_number=${yearNumber}` : JSON.stringify(years);
      throw new Error(
        `No year row for year_number=${yearNumber} (${yearRes.status}): ${detail} — seed years first.`
      );
    }
    yearId = yearRow.id;
  }

  const createResp = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: authAdminHeaders(serviceKey),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        ...(yearId ? { year_id: yearId } : {}),
      },
    }),
  });
  const userRes = await readJson(createResp);

  if (!createResp.ok || !userRes.id) {
    const detail = userRes.msg || userRes.message || userRes.error_code || JSON.stringify(userRes);
    throw new Error(`Supabase Admin API error (${createResp.status}): ${detail}`);
  }

  console.log(`Created auth user ${userRes.id} (${email}), already confirmed.`);

  const tokenResp = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const tokenJson = await readJson(tokenResp);
  if (!tokenResp.ok || !tokenJson.access_token) {
    const detail =
      tokenJson.msg || tokenJson.error_description || tokenJson.error || JSON.stringify(tokenJson);
    throw new Error(`Could not sign in newly created user to ensure_profile (${tokenResp.status}): ${detail}`);
  }
  const accessToken = tokenJson.access_token;
  if (!isJwt(accessToken)) {
    throw new Error("Auth token endpoint did not return a JWT access_token.");
  }

  const ensureResp = await fetch(`${base}/rest/v1/rpc/ensure_profile`, {
    method: "POST",
    headers: postgrestHeaders({ apikey: anonKey, accessToken }),
    body: "{}",
  });
  if (!ensureResp.ok) {
    throw new Error(`ensure_profile failed (${ensureResp.status}): ${await ensureResp.text()}`);
  }

  if (makeAdmin) {
    const bootstrapResp = await fetch(`${base}/rest/v1/rpc/bootstrap_first_main_admin`, {
      method: "POST",
      headers: postgrestHeaders({ apikey: anonKey, accessToken }),
      body: "{}",
    });
    if (bootstrapResp.ok) {
      console.log(`Promoted ${email} to Main Admin (bootstrap: no Main Admin existed).`);
    } else {
      const body = await bootstrapResp.text();
      const mainExists = /main_admin_exists/i.test(body);
      if (!mainExists) {
        throw new Error(`bootstrap_first_main_admin failed (${bootstrapResp.status}): ${body}`);
      }
      if (!isJwt(serviceKey)) {
        throw new Error(
          `A Main Admin already exists. Additional --admin accounts must be promoted with set_admin_role by a Main Admin. Opaque service-role keys are not PostgREST Bearers.`
        );
      }
      const patchRes = await fetch(`${base}/rest/v1/profiles?id=eq.${userRes.id}`, {
        method: "PATCH",
        headers: postgrestHeaders({
          apikey: serviceKey,
          accessToken: serviceKey,
          extra: { Prefer: "return=minimal" },
        }),
        body: JSON.stringify({ role: "admin", is_main_admin: false }),
      });
      if (!patchRes.ok) {
        throw new Error(`Failed to promote to limited admin: ${patchRes.status} ${await patchRes.text()}`);
      }
      console.log(
        `Promoted ${email} to admin with no permissions. A Main Admin must grant codes before they can mutate.`
      );
    }
  } else {
    const enrollFetch = await fetch(
      `${base}/rest/v1/enrollments?student_id=eq.${userRes.id}&status=eq.active&select=id`,
      { headers: postgrestHeaders({ apikey: anonKey, accessToken }) }
    );
    const enrollRes = await readJson(enrollFetch);
    if (!enrollFetch.ok || !Array.isArray(enrollRes) || !enrollRes[0]) {
      console.warn(
        `Warning: no active enrollment row found for ${email}. ` +
          `Check that year_id ${yearId} exists and ensure_profile() ran.`
      );
    } else {
      console.log(`Active class enrollment confirmed for ${email}.`);
    }
  }

  console.log("Done — sign in immediately, no email confirmation needed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
