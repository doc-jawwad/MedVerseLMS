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
    assert.match(src, /bytes=0-65535/);
    assert.match(src, /fetchR2ObjectStream/);
    assert.match(src, /rangeHeader/);
    assert.doesNotMatch(src, /getR2Object\(/);
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
    assert.match(src, /estimateOfflineQuota/);
    assert.match(src, /createOpfsPdfRangeTransport/);
    assert.match(src, /readOfflinePdfRange/);
    assert.match(src, /file\.slice/);
    assert.doesNotMatch(src, /showSaveFilePicker/);
  });

  it("viewer confirms offline size and persists reading progress", () => {
    const src = readFileSync(
      join("src", "components", "study", "pdf-viewer.tsx"),
      "utf8"
    );
    const progress = readFileSync(
      join("src", "lib", "study", "pdf-reading-progress.ts"),
      "utf8"
    );
    assert.match(src, /createOnlinePdfRangeTransport/);
    assert.match(src, /disableAutoFetch:\s*true/);
    assert.match(src, /Confirm save/);
    assert.match(src, /estimateOfflineQuota/);
    assert.match(src, /loadPdfReadingPage/);
    assert.match(src, /createDebouncedPageSaver/);
    assert.match(src, /fitWidthScale/);
    assert.match(src, /classList\.(add|remove)\("pinching"\)/);
    assert.match(src, /Failed — Retry/);
    assert.match(src, /createOpfsPdfRangeTransport/);
    assert.match(src, /requestCacheOfflineReader/);
    assert.match(src, /contentRevision/);
    assert.match(src, /TextLayer/);
    assert.match(src, /pdf-text-layer/);
    assert.match(progress, /mv-pdf-page:/);
    assert.match(progress, /pdf_reading_progress/);
    // Must not use pdfjs url-mode (broken against coerced leading 206).
    assert.doesNotMatch(src, /getDocument\(\{\s*url:\s*sourceUrl/);
  });

  it("online range transport issues explicit Range GETs with retries", () => {
    const src = readFileSync(
      join("src", "lib", "study", "offline-pdf-store.ts"),
      "utf8"
    );
    assert.match(src, /createOnlinePdfRangeTransport/);
    assert.match(src, /ONLINE_RANGE_MAX_ATTEMPTS/);
    assert.match(src, /Range:\s*`bytes=\$\{begin\}-\$\{endInclusive\}`/);
    assert.match(src, /PDFDataRangeTransport/);
  });
});
