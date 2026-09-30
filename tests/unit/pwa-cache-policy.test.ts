import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  isCacheableStaticAsset,
  isNeverCacheRequest,
  PWA_CACHE_NAME,
  PWA_NEVER_CACHE_PATH_PREFIXES,
} from "../../src/lib/pwa/cache-policy.ts";

const origin = "https://lms.example";

describe("PWA cache policy", () => {
  it("allows hashed Next static assets and branding icons", () => {
    assert.equal(
      isCacheableStaticAsset({
        method: "GET",
        url: `${origin}/_next/static/chunks/app.js`,
      }),
      true
    );
    assert.equal(
      isCacheableStaticAsset({
        method: "GET",
        url: `${origin}/icons/icon-192.png`,
      }),
      true
    );
    assert.equal(
      isCacheableStaticAsset({
        method: "GET",
        url: `${origin}/logo-icon.png`,
      }),
      true
    );
    assert.equal(
      isCacheableStaticAsset({
        method: "GET",
        url: `${origin}/logo-icon-on-dark.png`,
      }),
      true
    );
  });

  it("never caches navigations, RSC, PostgREST, Auth, or APIs", () => {
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/dashboard`,
        mode: "navigate",
        destination: "document",
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/dashboard?_rsc=1`,
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/rest/v1/test_attempts?select=*`,
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "POST",
        url: `${origin}/auth/v1/token`,
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/api/health`,
      }),
      true
    );
  });

  it("never caches exam attempts, PDFs, payment proofs, or signed R2 URLs", () => {
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/tests/11111111-1111-4111-8111-111111111111/attempt`,
      }),
      true
    );
    assert.equal(
      isCacheableStaticAsset({
        method: "GET",
        url: `${origin}/tests/11111111-1111-4111-8111-111111111111/attempt`,
      }),
      false
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/materials/notes.pdf`,
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `https://abc.r2.cloudflarestorage.com/payment-proofs/t/s/x`,
      }),
      true
    );
    assert.equal(
      isNeverCacheRequest({
        method: "GET",
        url: `${origin}/study-content/file?X-Amz-Signature=abc`,
      }),
      true
    );
  });

  it("keeps public/sw.js aligned with the TypeScript policy", () => {
    const sw = readFileSync(
      path.join(process.cwd(), "public/sw.js"),
      "utf8"
    );
    assert.match(sw, new RegExp(PWA_CACHE_NAME));
    assert.match(sw, /medverse-shell-v1/);
    assert.match(sw, /isOfflineShellPath|\/offline/);
    assert.match(sw, /CACHE_OFFLINE_SHELL/);
    assert.match(sw, /pdf\.worker\.min\.mjs/);
    for (const prefix of PWA_NEVER_CACHE_PATH_PREFIXES) {
      assert.ok(sw.includes(prefix), `sw.js missing ${prefix}`);
    }
    assert.match(sw, /payment-proof/);
    assert.match(sw, /study-content/);
    assert.match(sw, /_rsc/);
    assert.match(sw, /X-Amz-Signature/);
    assert.match(sw, /data\.type === "SKIP_WAITING"/);
    assert.match(sw, /addEventListener\("install"/);
    const installBlock = sw.slice(
      sw.indexOf('addEventListener("install"'),
      sw.indexOf('addEventListener("activate"')
    );
    assert.doesNotMatch(installBlock, /self\.skipWaiting\s*\(/);
  });

  it("recognizes offline shell paths", async () => {
    const { isOfflineShellPath } = await import(
      "../../src/lib/pwa/cache-policy.ts"
    );
    assert.equal(isOfflineShellPath("/offline"), true);
    assert.equal(isOfflineShellPath("/offline/read/abc"), true);
    assert.equal(isOfflineShellPath("/dashboard"), false);
  });
});
