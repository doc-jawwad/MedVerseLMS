import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  authAdminHeaders,
  isJwt,
  postgrestHeaders,
} from "../../scripts/lib/postgrest-auth.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SECRET = "sb_secret_testkey_notasecret";
const PUBLISHABLE = "sb_publishable_testkey_notasecret";
const USER_JWT =
  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig";
const SERVICE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

describe("postgrest-auth helpers", () => {
  it("rejects opaque sb_ keys as JWTs", () => {
    assert.equal(isJwt(SECRET), false);
    assert.equal(isJwt(PUBLISHABLE), false);
    assert.equal(isJwt(USER_JWT), true);
    assert.equal(isJwt(SERVICE_JWT), true);
  });

  it("keeps sb_secret as Auth Admin Bearer", () => {
    const headers = authAdminHeaders(SECRET);
    assert.equal(headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(headers.apikey, SECRET);
  });

  it("does not send opaque secrets as PostgREST Bearer", () => {
    const headers = postgrestHeaders({
      apikey: PUBLISHABLE,
      accessToken: SECRET,
    });
    assert.equal(headers.apikey, PUBLISHABLE);
    assert.equal(headers.Authorization, undefined);
  });

  it("sends a user JWT as PostgREST Bearer", () => {
    const headers = postgrestHeaders({
      apikey: PUBLISHABLE,
      accessToken: USER_JWT,
    });
    assert.equal(headers.Authorization, `Bearer ${USER_JWT}`);
  });
});

describe("create-dev-account PostgREST usage", () => {
  const src = fs.readFileSync(
    path.join(root, "scripts/create-dev-account.mjs"),
    "utf8"
  );

  it("looks up years via anon list_years, not a service-role table PATCH", () => {
    assert.match(src, /rpc\/list_years/);
    assert.match(src, /bootstrap_first_main_admin/);
    assert.match(src, /ensure_profile/);
    assert.doesNotMatch(src, /\/rest\/v1\/years\?/);
  });

  it("does not PATCH enrollments through PostgREST", () => {
    assert.doesNotMatch(src, /\/rest\/v1\/enrollments\?[^`]*method:\s*"PATCH"/s);
  });

  it("reads the password from DEV_ACCOUNT_PASSWORD, not argv", () => {
    assert.match(src, /DEV_ACCOUNT_PASSWORD/);
    assert.doesNotMatch(src, /<email> <password>/);
    assert.doesNotMatch(src, /Passw0rd!23/);
  });

  it("does not log the account email", () => {
    assert.doesNotMatch(src, /console\.log\([^)]*\$\{email\}/);
    assert.doesNotMatch(src, /console\.warn\([^)]*\$\{email\}/);
  });
});

describe("seed.sql example passwords", () => {
  it("does not embed a sample password", () => {
    const seed = fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
    assert.doesNotMatch(seed, /Passw0rd!23/);
    assert.match(seed, /DEV_ACCOUNT_PASSWORD/);
  });
});
