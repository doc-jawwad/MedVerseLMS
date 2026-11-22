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

describe("createInternalRestFetch method/body/header preservation", () => {
  const seen: { url: string; method: string; body: string; headers: Headers }[] = [];
  const spy: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    seen.push({
      url: req.url,
      method: req.method,
      body: await req.text(),
      headers: req.headers,
    });
    return new Response("{}");
  };
  const f = createInternalRestFetch(PUB, INT, spy);

  it("maps the Caddy strip_prefix cases exactly", async () => {
    seen.length = 0;
    await f(`${PUB}/rest/v1/questions`, {});
    await f(`${PUB}/rest/v1/rpc/example`, {});
    assert.deepEqual(
      seen.map((s) => s.url),
      [`${INT}/questions`, `${INT}/rpc/example`]
    );
  });
  it("keeps method, body, query string and JWT/apikey headers (init form)", async () => {
    seen.length = 0;
    await f(`${PUB}/rest/v1/rpc/example?select=a&order=b.desc`, {
      method: "POST",
      body: '{"x":1}',
      headers: { authorization: "Bearer eyJa.b.c", apikey: "k", "content-type": "application/json", prefer: "count=exact" },
    });
    const s = seen[0];
    assert.equal(s.url, `${INT}/rpc/example?select=a&order=b.desc`);
    assert.equal(s.method, "POST");
    assert.equal(s.body, '{"x":1}');
    assert.equal(s.headers.get("authorization"), "Bearer eyJa.b.c");
    assert.equal(s.headers.get("apikey"), "k");
    assert.equal(s.headers.get("prefer"), "count=exact");
  });
  it("keeps method, body and headers for Request input", async () => {
    seen.length = 0;
    await f(
      new Request(`${PUB}/rest/v1/questions?id=eq.1`, {
        method: "PATCH",
        body: '{"status":"approved"}',
        headers: { authorization: "Bearer sb_publishable_x", apikey: "k", "content-type": "application/json" },
      })
    );
    const s = seen[0];
    assert.equal(s.url, `${INT}/questions?id=eq.1`);
    assert.equal(s.method, "PATCH");
    assert.equal(s.body, '{"status":"approved"}');
    assert.equal(s.headers.get("authorization"), null); // opaque key stripped
    assert.equal(s.headers.get("apikey"), "k");
  });
});
