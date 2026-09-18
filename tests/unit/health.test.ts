import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeReady,
  isLoopbackAddress,
  isLoopbackHost,
  livenessBody,
  postgrestProbeUrl,
} from "../../src/lib/health.ts";

describe("liveness", () => {
  it("returns ok without secrets or hostnames", () => {
    const body = livenessBody();
    assert.equal(body.ok, true);
    assert.equal(body.service, "medverse-lms");
    assert.equal(JSON.stringify(body).includes("postgres"), false);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });
});

describe("authorizeReady", () => {
  const secret = "test-cron-secret";

  it("rejects anonymous public requests", () => {
    assert.equal(
      authorizeReady({
        host: "lms.example.com",
        xForwardedFor: "203.0.113.10",
        authorization: null,
        cronSecret: secret,
      }),
      false
    );
  });

  it("accepts Bearer CRON_SECRET", () => {
    assert.equal(
      authorizeReady({
        host: "lms.example.com",
        xForwardedFor: "203.0.113.10",
        authorization: `Bearer ${secret}`,
        cronSecret: secret,
      }),
      true
    );
  });

  it("does not treat X-Forwarded-For 127.0.0.1 as localhost", () => {
    assert.equal(
      authorizeReady({
        host: "lms.example.com",
        xForwardedFor: "127.0.0.1",
        authorization: null,
        cronSecret: secret,
      }),
      false
    );
  });

  it("accepts direct loopback Host without X-Forwarded-For", () => {
    assert.equal(
      authorizeReady({
        host: "127.0.0.1:3000",
        xForwardedFor: null,
        authorization: null,
        cronSecret: secret,
      }),
      true
    );
  });

  it("rejects loopback Host when Caddy has set X-Forwarded-For", () => {
    assert.equal(
      authorizeReady({
        host: "127.0.0.1:3000",
        xForwardedFor: "203.0.113.10",
        authorization: null,
        cronSecret: secret,
      }),
      false
    );
  });
});

describe("isLoopback", () => {
  it("recognizes ipv4 and ipv6 loopback", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("8.8.8.8"), false);
    assert.equal(isLoopbackHost("localhost:3000"), true);
    assert.equal(isLoopbackHost("lms.example.com"), false);
  });
});

describe("postgrestProbeUrl", () => {
  it("prefers the internal loopback URL", () => {
    assert.equal(
      postgrestProbeUrl({
        internalUrl: "http://127.0.0.1:3001/",
        publicSupabaseUrl: "https://example.supabase.co",
      }),
      "http://127.0.0.1:3001"
    );
  });

  it("falls back to public origin /rest/v1/", () => {
    assert.equal(
      postgrestProbeUrl({
        publicSupabaseUrl: "https://lms.example.com",
      }),
      "https://lms.example.com/rest/v1/"
    );
  });
});
