import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("protected pdf reader policy", () => {
  it("study-content route streams Range without full buffering", () => {
    const src = readFileSync(
      join("src", "app", "api", "study-content", "[materialId]", "route.ts"),
      "utf8"
    );
    assert.match(src, /fetchR2ObjectStream/);
    assert.match(src, /rangeHeader/);
    assert.doesNotMatch(src, /getR2Object\(/);
    assert.doesNotMatch(src, /await .*\.arrayBuffer\(\)/);
  });

  it("pdf viewer uses PDF.js and has no Download control", () => {
    const src = readFileSync(
      join("src", "components", "study", "pdf-viewer.tsx"),
      "utf8"
    );
    assert.match(src, /pdfjs-dist/);
    assert.match(src, /Save for Offline/);
    assert.doesNotMatch(src, /Download PDF/i);
    assert.doesNotMatch(src, /createObjectURL/);
    assert.doesNotMatch(src, /toolbar=1/);
  });

  it("offline store uses OPFS not Downloads", () => {
    const src = readFileSync(
      join("src", "lib", "study", "offline-pdf-store.ts"),
      "utf8"
    );
    assert.match(src, /getDirectory/);
    assert.match(src, /entitlementExpiresAt/);
    assert.doesNotMatch(src, /showSaveFilePicker/);
  });
});
