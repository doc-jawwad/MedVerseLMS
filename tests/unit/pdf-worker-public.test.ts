import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("public PDF.js worker path", () => {
  it("ships the static worker under public/", () => {
    assert.equal(existsSync(join(root, "public/pdf.worker.min.mjs")), true);
  });

  it("excludes only pdf.worker.min.mjs from the auth proxy matcher", () => {
    const proxy = read("src/proxy.ts");
    // Matcher negative-lookahead source text escapes dots as \\.
    assert.match(proxy, /pdf\\\\.worker\\\\.min\\\\.mjs/);
    assert.match(proxy, /pathname === "\/pdf\.worker\.min\.mjs"/);
    // Must not open the gate to arbitrary .mjs application routes.
    assert.doesNotMatch(
      proxy,
      /\|\.\*\\\.\(\?:svg\|png\|jpg\|jpeg\|gif\|webp\|ico\|mjs\)\$/
    );
    assert.doesNotMatch(proxy, /\\\.\(\?:mjs\)/);
  });

  it("bypasses Auth client construction for the worker (same class as sw.js)", () => {
    const proxy = read("src/proxy.ts");
    const early = proxy.slice(
      proxy.indexOf("PWA install assets"),
      proxy.indexOf("let response = nextWithPathname")
    );
    assert.match(early, /pathname === "\/pdf\.worker\.min\.mjs"/);
    assert.match(early, /pathname === "\/sw\.js"/);
    assert.doesNotMatch(early, /createServerClient|getClaims/);
  });

  it("sets public cache headers for the worker in next.config", () => {
    const cfg = read("next.config.ts");
    assert.match(cfg, /source:\s*"\/pdf\.worker\.min\.mjs"/);
    assert.match(cfg, /public, max-age=86400/);
    assert.doesNotMatch(
      cfg.slice(cfg.indexOf("/pdf.worker.min.mjs")),
      /no-store/
    );
  });

  it("keeps study-content entitlement checks and proxy-protected", () => {
    const route = read("src/app/api/study-content/[materialId]/route.ts");
    const proxy = read("src/proxy.ts");
    assert.match(route, /authorize_study_object/);
    assert.match(route, /private, no-store/);
    // study-content must still enter the auth proxy (not matcher-excluded).
    assert.doesNotMatch(proxy, /study-content/);
    assert.match(
      proxy,
      /if \(!isAuthed && !isPublic\)/
    );
  });

  it("viewer still points at the public worker URL", () => {
    const viewer = read("src/components/study/pdf-viewer.tsx");
    assert.match(viewer, /workerSrc = "\/pdf\.worker\.min\.mjs"/);
  });
});
