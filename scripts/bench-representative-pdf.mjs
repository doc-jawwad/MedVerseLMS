#!/usr/bin/env node
/**
 * Local-only range benchmark for a 200-page gen-representative-pdf fixture.
 * node --experimental-strip-types scripts/bench-representative-pdf.mjs <file.pdf>
 * Measures PDF.js operator/text extraction, NOT browser paint or network latency.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { measurePageBases, createPdfPageMeasureQueue } from "../src/lib/study/pdf-scroll.ts";

const require = createRequire(import.meta.url);
const fonts = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts").replaceAll("\\", "/") + "/";
const file = process.argv[2];
if (!file) {
  console.error("Usage: node --experimental-strip-types scripts/bench-representative-pdf.mjs <file.pdf>");
  process.exit(2);
}
const length = fs.statSync(file).size;
assert.ok(length > 200_000_000 && length < 210_000_000, "Expected generated 200-page fixture");
const fd = fs.openSync(file, "r");

function read(begin, end) {
  const data = new Uint8Array(end - begin);
  assert.equal(fs.readSync(fd, data, 0, data.length, begin), data.length);
  return data;
}

async function trial(mode, target) {
  let bytes = 65536, requests = 1;
  class Transport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      requests++;
      bytes += end - begin;
      queueMicrotask(() => this.onDataRange(begin, read(begin, end)));
    }
  }
  const start = performance.now();
  const task = pdfjs.getDocument({
    range: new Transport(length, read(0, 65536)), length,
    disableAutoFetch: true, disableStream: true, rangeChunkSize: 512 * 1024,
    standardFontDataUrl: fonts, disableFontFace: true, useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    assert.equal(doc.numPages, 200);
    const startupBytes = bytes;
    if (mode === "eager") {
      await measurePageBases(doc, 8);
      await doc.getOutline();
    } else {
      const measure = createPdfPageMeasureQueue(doc, 4);
      assert.ok(await measure(target, new AbortController().signal));
    }
    const page = await doc.getPage(target), viewport = page.getViewport({ scale: 1 });
    const expected = (target - 1) % 3 === 0 ? [612, 792] : (target - 1) % 3 === 1 ? [792, 612] : [500, 1000];
    assert.deepEqual([viewport.width, viewport.height], expected);
    const ops = await page.getOperatorList();
    assert.ok(ops.fnArray.includes(pdfjs.OPS.paintImageXObject), "Image operator missing");
    const text = await page.getTextContent();
    assert.ok(text.items.some(x => x.str === "MedVerse QA page " + target + " of 200"));
    return { mode, target, startupBytes, bytes, requests, operatorAndTextMs: Math.round(performance.now() - start) };
  } finally {
    await task.destroy();
  }
}

try {
  for (const target of [1, 137, 200]) {
    const eager = await trial("eager", target), progressive = await trial("progressive", target);
    console.log(JSON.stringify({ eager, progressive }));
    assert.ok(progressive.bytes < eager.bytes, "Expected fewer requested bytes");
    assert.ok(progressive.requests < eager.requests, "Expected fewer range requests");
  }
  console.log("REAL_IMAGE_TEXT_RANGE_COMPARISON_PASS");
} finally {
  fs.closeSync(fd);
}
