import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCspHeaderValue } from "../../src/lib/security/csp.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Body hash must ignore patch-script trailing newline and checkout CRLF. */
function normalizeSonnerCssBody(raw: string): string {
  return raw
    .replace(/^\/\*[\s\S]*?\*\/\s*/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "");
}

function cspDirective(csp: string, name: string): string | null {
  const m = csp.match(new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

describe("sonner CSP style extraction", () => {
  it("ships static sonner CSS matching the former inline hash", () => {
    const cssPath = path.join(root, "src/styles/sonner-toast.css");
    assert.equal(fs.existsSync(cssPath), true);
    const raw = fs.readFileSync(cssPath, "utf8");
    const css = normalizeSonnerCssBody(raw);
    assert.match(css, /\[data-sonner-toaster\]/);
    const hash = crypto.createHash("sha256").update(css, "utf8").digest("base64");
    assert.equal(hash, "StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=");
  });

  it("imports sonner CSS from globals and patches insertCSS via script", () => {
    const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    assert.match(globals, /sonner-toast\.css/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    assert.match(pkg.scripts.postinstall, /patch-sonner-csp/);
    assert.match(pkg.scripts.prebuild, /patch-sonner-csp/);
    const patch = fs.readFileSync(
      path.join(root, "scripts/patch-sonner-csp.mjs"),
      "utf8"
    );
    assert.match(patch, /__insertCSS/);
    assert.match(patch, /MedVerse CSP/);
  });

  it("does not allow style-src-elem unsafe-inline in CSP builder", () => {
    const csp = buildCspHeaderValue({
      nonce: "sonner-test-nonce",
      isDev: false,
    });
    const styleSrcElem = cspDirective(csp, "style-src-elem");
    const styleSrcAttr = cspDirective(csp, "style-src-attr");
    const styleSrc = cspDirective(csp, "style-src");
    assert.ok(styleSrcElem, "style-src-elem directive present");
    assert.ok(styleSrcAttr, "style-src-attr directive present");
    assert.ok(styleSrc, "style-src directive present");
    assert.match(styleSrcElem!, /'nonce-sonner-test-nonce'/);
    assert.doesNotMatch(styleSrcElem!, /'unsafe-inline'/);
    assert.match(styleSrc!, /'nonce-sonner-test-nonce'/);
    assert.doesNotMatch(styleSrc!, /'unsafe-inline'/);
    assert.match(styleSrcAttr!, /'unsafe-inline'/);
  });
});
