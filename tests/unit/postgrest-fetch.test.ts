import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchWithoutApiKeyBearerOnPostgrest,
  isJwt,
  isPostgrestRequestUrl,
  stripNonJwtPostgrestAuthorization,
} from "../../src/lib/supabase/postgrest-fetch.ts";

const PUBLISHABLE = "sb_publishable_testkey_notasecret";
const SECRET = "sb_secret_testkey_notasecret";
const USER_JWT =
  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig";
const SERVICE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";

describe("isJwt", () => {
  it("accepts compact JWTs and rejects opaque sb_ keys", () => {
    assert.equal(isJwt(USER_JWT), true);
    assert.equal(isJwt(SERVICE_JWT), true);
    assert.equal(isJwt(PUBLISHABLE), false);
    assert.equal(isJwt(SECRET), false);
    assert.equal(isJwt("not-a-jwt"), false);
  });
});

describe("isPostgrestRequestUrl", () => {
  it("matches /rest/v1 only", () => {
    assert.equal(
      isPostgrestRequestUrl("https://lms.example.com/rest/v1/profiles"),
      true
    );
    assert.equal(
      isPostgrestRequestUrl("https://lms.example.com/rest/v1/rpc/ensure_profile"),
      true
    );
    assert.equal(
      isPostgrestRequestUrl("https://lms.example.com/auth/v1/token"),
      false
    );
    assert.equal(
      isPostgrestRequestUrl("https://lms.example.com/auth/v1/admin/users"),
      false
    );
  });
});

describe("stripNonJwtPostgrestAuthorization", () => {
  it("removes sb_publishable Bearer and keeps apikey", () => {
    const headers = stripNonJwtPostgrestAuthorization(
      new Headers({
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${PUBLISHABLE}`,
      })
    );
    assert.equal(headers.get("apikey"), PUBLISHABLE);
    assert.equal(headers.get("Authorization"), null);
  });

  it("keeps a real user JWT as Bearer", () => {
    const headers = stripNonJwtPostgrestAuthorization(
      new Headers({
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${USER_JWT}`,
      })
    );
    assert.equal(headers.get("apikey"), PUBLISHABLE);
    assert.equal(headers.get("Authorization"), `Bearer ${USER_JWT}`);
  });
});

describe("fetchWithoutApiKeyBearerOnPostgrest", () => {
  it("strips opaque Bearer on PostgREST and leaves Auth alone", async () => {
    const seen: { url: string; auth: string | null; apikey: string | null }[] =
      [];
    const fake: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        auth: headers.get("Authorization"),
        apikey: headers.get("apikey"),
      });
      return new Response("{}", { status: 200 });
    };
    const wrapped = fetchWithoutApiKeyBearerOnPostgrest(fake);

    await wrapped("https://lms.example.com/rest/v1/years", {
      headers: {
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${PUBLISHABLE}`,
      },
    });
    await wrapped("https://lms.example.com/rest/v1/rpc/list_years", {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${USER_JWT}`,
      },
    });
    await wrapped("https://lms.example.com/auth/v1/token?grant_type=password", {
      headers: {
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${PUBLISHABLE}`,
      },
    });
    await wrapped("https://lms.example.com/rest/v1/rpc/auto_submit_expired", {
      method: "POST",
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
      },
    });
    await wrapped("https://lms.example.com/auth/v1/admin/users", {
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
      },
    });

    assert.equal(seen[0].apikey, PUBLISHABLE);
    assert.equal(seen[0].auth, null);

    assert.equal(seen[1].apikey, PUBLISHABLE);
    assert.equal(seen[1].auth, `Bearer ${USER_JWT}`);

    assert.equal(seen[2].apikey, PUBLISHABLE);
    assert.equal(seen[2].auth, `Bearer ${PUBLISHABLE}`);

    assert.equal(seen[3].apikey, SECRET);
    assert.equal(seen[3].auth, null);

    assert.equal(seen[4].apikey, SECRET);
    assert.equal(seen[4].auth, `Bearer ${SECRET}`);
  });
});
