#!/usr/bin/env node
/**
 * Generate a synthetic PDF of approximately `bytes` size (not committed).
 * Usage: node scripts/gen-synthetic-pdf.mjs <path> <bytes>
 * Minimal valid header + padding stream so %PDF- magic validates.
 */
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const target = Number(process.argv[3]);
if (!out || !Number.isFinite(target) || target < 1024) {
  console.error("Usage: node scripts/gen-synthetic-pdf.mjs <path> <bytes>");
  process.exit(2);
}

const header =
  "%PDF-1.4\n" +
  "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n" +
  "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n" +
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\n" +
  "xref\n0 4\n0000000000 65535 f \n" +
  "trailer<< /Size 4 /Root 1 0 R >>\n" +
  "startxref\n0\n%%EOF\n";

const padNeeded = Math.max(0, target - Buffer.byteLength(header) - 64);
const fd = fs.openSync(out, "w");
fs.writeSync(fd, header);
const chunk = Buffer.alloc(1024 * 1024, 0x20);
let left = padNeeded;
while (left > 0) {
  const n = Math.min(left, chunk.length);
  fs.writeSync(fd, chunk, 0, n);
  left -= n;
}
fs.writeSync(fd, "\n%%EOF\n");
fs.closeSync(fd);
const size = fs.statSync(out).size;
console.log(JSON.stringify({ path: path.resolve(out), bytes: size }));
