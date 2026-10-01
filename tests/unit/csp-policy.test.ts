import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCspToResponse,
  buildCspHeaderValue,
  cspResponseHeaderName,
  extractR2ConnectOrigin,
  extractSentryIngestOrigin,
  resolveCspMode,
} from "../../src/lib/security/csp.ts";

describe("CSP policy inventory", () => {
  it("defaults to report-only and maps mode aliases", () => {
    assert.equal(resolveCspMode(undefined), "report-only");
    assert.equal(resolveCspMode(""), "report-only");
    assert.equal(resolveCspMode("enforce"), "enforce");
    assert.equal(resolveCspMode("ENFORCED"), "enforce");
    assert.equal(resolveCspMode("off"), "off");
    assert.equal(resolveCspMode("disabled"), "off");
  });

  it("extracts Sentry and R2 origins from env-shaped values", () => {
    assert.equal(
      extractSentryIngestOrigin(
        "https://abc123@o999.ingest.de.sentry.io/12345"
      ),
      "https://o999.ingest.de.sentry.io"
    );
    assert.equal(
      extractR2ConnectOrigin("https://acct.r2.cloudflarestorage.com"),
      "https://acct.r2.cloudflarestorage.com"
    );
    assert.equal(extractSentryIngestOrigin(""), null);
  });

  it("builds a nonce policy covering audited origins without unsafe-eval in prod", () => {
    const csp = buildCspHeaderValue({
      nonce: "test-nonce",
      isDev: false,
      sentryDsn: "https://k@o1.ingest.de.sentry.io/9",
      r2Endpoint: "https://acct.r2.cloudflarestorage.com",
    });
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src [^;]*'nonce-test-nonce'/);
    assert.match(csp, /'strict-dynamic'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.match(csp, /style-src-attr 'unsafe-inline'/);
    assert.match(csp, /connect-src [^;]*'self'/);
    assert.match(csp, /https:\/\/\*\.r2\.cloudflarestorage\.com/);
    assert.match(csp, /https:\/\/o1\.ingest\.de\.sentry\.io/);
    assert.match(csp, /frame-src [^;]*https:\/\/www\.youtube\.com/);
    assert.match(csp, /worker-src 'self' blob:/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /upgrade-insecure-requests/);
    // Browser must not need direct R2 img GETs after payment/avatar proxies.
    assert.doesNotMatch(csp, /img-src [^;]*r2\.cloudflarestorage/);
  });

  it("allows unsafe-eval only in development", () => {
    const csp = buildCspHeaderValue({
      nonce: "dev-nonce",
      isDev: true,
    });
    assert.match(csp, /'unsafe-eval'/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });

  it("maps response header names by mode", () => {
    assert.equal(cspResponseHeaderName("report-only"), "Content-Security-Policy-Report-Only");
    assert.equal(cspResponseHeaderName("enforce"), "Content-Security-Policy");
    assert.equal(cspResponseHeaderName("off"), null);

    const headers = new Map<string, string>();
    const res = {
      headers: {
        set(k: string, v: string) {
          headers.set(k, v);
        },
        delete(k: string) {
          headers.delete(k);
        },
      },
    };
    applyCspToResponse(res, "default-src 'self'", "report-only");
    assert.equal(headers.has("Content-Security-Policy"), false);
    assert.equal(
      headers.get("Content-Security-Policy-Report-Only"),
      "default-src 'self'"
    );
    applyCspToResponse(res, "default-src 'self'", "enforce");
    assert.equal(headers.get("Content-Security-Policy"), "default-src 'self'");
    assert.equal(headers.has("Content-Security-Policy-Report-Only"), false);
  });
});
