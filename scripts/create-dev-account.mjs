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
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (server-only key — never
// commit it, never expose it to the client). This script talks directly to
// whatever project NEXT_PUBLIC_SUPABASE_URL in .env.local points at — check
// that file before running this against anything you don't intend to write
// real data into. There is currently only one Supabase project behind this
// repo (dev and production are NOT separated); see docs/deployment.md.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) {
    throw new Error(".env.local not found — copy .env.local.example and fill it in first.");
  }
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
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

  const env = loadEnvLocal();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.local."
    );
  }

  console.log(`Target project: ${base}`);

  let yearId;
  if (!makeAdmin) {
    const yearNumber = Number(yearArg) || 1;
    const yearRes = await fetch(
      `${base}/rest/v1/years?year_number=eq.${yearNumber}&select=id`,
      { headers: headers(serviceKey) }
    ).then((r) => r.json());
    if (!yearRes[0]) {
      throw new Error(
        `No year row for year_number=${yearNumber} — run the years/subjects seed first (supabase/seed.sql).`
      );
    }
    yearId = yearRes[0].id;
  }

  const createResp = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(serviceKey),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // skips /verify-email entirely — no email is sent
      user_metadata: {
        full_name: fullName,
        ...(yearId ? { year_id: yearId } : {}),
      },
    }),
  });
  const userRes = await createResp.json();

  // Checked by HTTP status, not response-body shape: the Admin API's error
  // payload isn't consistently {error_code, msg} across failure types (e.g.
  // "already registered" vs. a malformed request), so a shape-based check
  // silently passed through some failures with `userRes.id` left undefined.
  if (!createResp.ok || !userRes.id) {
    const detail = userRes.msg || userRes.message || userRes.error_code || JSON.stringify(userRes);
    throw new Error(`Supabase Admin API error (${createResp.status}): ${detail}`);
  }

  console.log(`Created auth user ${userRes.id} (${email}), already confirmed.`);

  if (makeAdmin) {
    // handle_new_user() always creates the profile as role='student'
    // (docs/database.md) — promotion to admin is deliberately only possible
    // via SQL/service role, never self-service.
    const patchRes = await fetch(`${base}/rest/v1/profiles?id=eq.${userRes.id}`, {
      method: "PATCH",
      headers: headers(serviceKey, { Prefer: "return=minimal" }),
      body: JSON.stringify({ role: "admin" }),
    });
    if (!patchRes.ok) {
      throw new Error(`Failed to promote to admin: ${patchRes.status} ${await patchRes.text()}`);
    }
    console.log(`Promoted ${email} to admin.`);
  } else {
    // handle_new_user() already created a 'pending' enrollment; activate it
    // so the account is immediately usable without a separate admin-approval
    // click during local dev/testing.
    const enrollFetch = await fetch(
      `${base}/rest/v1/enrollments?student_id=eq.${userRes.id}&select=id`,
      { headers: headers(serviceKey) }
    );
    const enrollRes = await enrollFetch.json();
    if (!enrollFetch.ok || !Array.isArray(enrollRes) || !enrollRes[0]) {
      // handle_new_user() should always have inserted a 'pending' row for a
      // valid year_id — surface this loudly rather than finishing silently
      // with an account that has no enrollment to activate.
      console.warn(
        `Warning: no enrollment row found for ${email} — the account was created but has no active enrollment. ` +
          `Check that year_id ${yearId} exists and handle_new_user() ran.`
      );
    } else {
      await fetch(`${base}/rest/v1/enrollments?id=eq.${enrollRes[0].id}`, {
        method: "PATCH",
        headers: headers(serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({ status: "active" }),
      });
      console.log(`Enrollment activated for ${email}.`);
    }
  }

  console.log("Done — sign in immediately, no email confirmation needed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
