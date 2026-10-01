import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("sonner CSP style extraction", () => {
  it("ships static sonner CSS matching the former inline hash", () => {
    const cssPath = path.join(root, "src/styles/sonner-toast.css");
    assert.equal(fs.existsSync(cssPath), true);
    const raw = fs.readFileSync(cssPath, "utf8");
    // Strip header comment block
    const css = raw.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
    const hash = crypto.createHash("sha256").update(css, "utf8").digest("base64");
    assert.equal(hash, "StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY=");
    assert.match(css, /\[data-sonner-toaster\]/);
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
    const src = fs.readFileSync(
      path.join(root, "src/lib/security/csp.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /style-src-elem[^;]*unsafe-inline/);
    assert.match(src, /style-src-attr 'unsafe-inline'/);
  });
});
