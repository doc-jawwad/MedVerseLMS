import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("CSP wiring", () => {
  it("proxy generates nonce and applies CSP from shared module", () => {
    const src = read("src/proxy.ts");
    assert.match(src, /buildCspHeaderValue/);
    assert.match(src, /applyCspToResponse/);
    assert.match(src, /x-nonce/);
    assert.match(src, /resolveCspMode/);
    // SW assets skip app CSP (keep next.config SW CSP).
    assert.match(src, /\/sw\.js/);
  });

  it("root layout is dynamic and passes nonce to ThemeProvider", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /force-dynamic/);
    assert.match(layout, /headers\(\)/);
    assert.match(layout, /x-nonce/);
    assert.match(layout, /ThemeProvider nonce=/);
  });

  it("ThemeProvider forwards nonce to next-themes", () => {
    const src = read("src/components/theme/theme-provider.tsx");
    assert.match(src, /nonce=\{nonce\}/);
  });

  it("deployment docs document MEDVERSE_CSP_MODE", () => {
    const docs = read("docs/deployment.md");
    assert.match(docs, /MEDVERSE_CSP_MODE/);
    assert.match(docs, /report-only/);
  });
});
