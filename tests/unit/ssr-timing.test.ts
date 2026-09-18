import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  buildSsrTimingPayload,
  createSsrTimingStore,
  flushSsrTiming,
  formatSsrTimingLog,
  markSsrPageFnEnd,
  runSsrSpan,
  runSsrSpanSync,
  sanitizeSsrTimingToken,
  ssrTimingEnabled,
} from "../../src/lib/observability/ssr-timing.ts";

describe("ssrTimingEnabled", () => {
  it("is off unless load-test env and explicit flag", () => {
    const prevTiming = process.env.LOADTEST_SSR_TIMING;
    const prevEnv = process.env.MEDVERSE_ENV;
    delete process.env.LOADTEST_SSR_TIMING;
    process.env.MEDVERSE_ENV = "loadtest";
    assert.equal(ssrTimingEnabled(), false);

    process.env.LOADTEST_SSR_TIMING = "1";
    process.env.MEDVERSE_ENV = "production";
    assert.equal(ssrTimingEnabled(), false);

    process.env.LOADTEST_SSR_TIMING = "1";
    process.env.MEDVERSE_ENV = "loadtest";
    assert.equal(ssrTimingEnabled(), true);

    process.env.LOADTEST_SSR_TIMING = prevTiming;
    process.env.MEDVERSE_ENV = prevEnv;
  });
});

describe("sanitizeSsrTimingToken", () => {
  it("strips cookies, tokens, and spaces", () => {
    assert.equal(sanitizeSsrTimingToken("phase0t"), "phase0t");
    assert.equal(
      sanitizeSsrTimingToken("Authorization: Bearer abc.def.ghi"),
      "Authorization:Bearerabc.def.ghi"
    );
    assert.equal(sanitizeSsrTimingToken("cookie=secret value"), "cookiesecretvalue");
    assert.equal(sanitizeSsrTimingToken(""), "none");
  });
});

describe("ssr timing store", () => {
  it("records named spans and splits page vs remaining time", async () => {
    const store = createSsrTimingStore({
      route: "/tests",
      req: "stu-351",
      run: "phase0t",
    });
    await runSsrSpan(store, "auth.profiles", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    runSsrSpanSync(store, "in_process.classify", () => 1);
    markSsrPageFnEnd(store);
    await new Promise((r) => setTimeout(r, 5));
    const payload = buildSsrTimingPayload(store, "rsc");
    assert.equal(payload.tag, "ssr_timing");
    assert.equal(payload.route, "/tests");
    assert.equal(payload.req, "stu-351");
    assert.equal(payload.run, "phase0t");
    assert.equal(payload.spans[0]?.name, "auth.profiles");
    assert.ok((payload.spans[0]?.ms ?? 0) >= 4);
    assert.equal(payload.spans[1]?.name, "in_process.classify");
    assert.ok((payload.page_fn_ms ?? 0) > 0);
    assert.ok((payload.html_ms ?? 0) >= 4);
    assert.ok(!formatSsrTimingLog(store, "rsc").includes("Bearer"));
  });

  it("flushes once", () => {
    const store = createSsrTimingStore({ route: "/tests/id/result" });
    const logged: string[] = [];
    const original = console.info;
    console.info = ((line: string) => {
      logged.push(line);
    }) as typeof console.info;
    try {
      const first = flushSsrTiming(store, "rsc");
      const second = flushSsrTiming(store, "rsc");
      assert.ok(first);
      assert.equal(second, null);
      assert.equal(logged.length, 1);
      assert.match(logged[0] ?? "", /"tag":"ssr_timing"/);
    } finally {
      console.info = original;
    }
  });

  it("is a no-op when store is null", async () => {
    const fn = mock.fn(async () => "ok");
    assert.equal(await runSsrSpan(null, "fetch.tests", fn), "ok");
    assert.equal(fn.mock.callCount(), 1);
  });
});
