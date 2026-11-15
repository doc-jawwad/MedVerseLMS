import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteRestToInternal } from "../../src/lib/supabase/postgrest-fetch.ts";

const PUB = "https://lms.medversepk.com";
const INT = "http://127.0.0.1:3001";

describe("rewriteRestToInternal", () => {
  it("strips /rest/v1 and targets loopback PostgREST", () => {
    assert.equal(
      rewriteRestToInternal(`${PUB}/rest/v1/questions?select=id&limit=5`, PUB, INT),
      `${INT}/questions?select=id&limit=5`
    );
    assert.equal(
      rewriteRestToInternal(`${PUB}/rest/v1/rpc/get_academic_tree`, PUB, `${INT}/`),
      `${INT}/rpc/get_academic_tree`
    );
  });
  it("never touches auth, storage, other hosts or lookalike paths", () => {
    assert.equal(rewriteRestToInternal(`${PUB}/auth/v1/token`, PUB, INT), null);
    assert.equal(rewriteRestToInternal(`${PUB}/rest/v1x/foo`, PUB, INT), null);
    assert.equal(rewriteRestToInternal("https://evil.example/rest/v1/x", PUB, INT), null);
  });
  it("is a no-op when the internal URL is unset", () => {
    assert.equal(rewriteRestToInternal(`${PUB}/rest/v1/x`, PUB, undefined), null);
    assert.equal(rewriteRestToInternal(`${PUB}/rest/v1/x`, PUB, " "), null);
  });
});

import { createInternalRestFetch } from "../../src/lib/supabase/postgrest-fetch.ts";

describe("createInternalRestFetch", () => {
  const calls: { url: string; auth: string | null }[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response("{}");
  };
  const f = createInternalRestFetch(PUB, INT, fake);

  it("rewrites REST, drops opaque sb_ Bearer, keeps a real JWT", async () => {
    calls.length = 0;
    await f(`${PUB}/rest/v1/questions`, { headers: { authorization: "Bearer sb_secret_x" } });
    await f(`${PUB}/rest/v1/rpc/x`, { headers: { authorization: "Bearer eyJa.b.c" } });
    assert.deepEqual(calls, [
      { url: `${INT}/questions`, auth: null },
      { url: `${INT}/rpc/x`, auth: "Bearer eyJa.b.c" },
    ]);
  });
  it("leaves non-REST URLs alone", async () => {
    calls.length = 0;
    await f(`${PUB}/auth/v1/user`, {});
    assert.equal(calls[0].url, `${PUB}/auth/v1/user`);
  });
});
