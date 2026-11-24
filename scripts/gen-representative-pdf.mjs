#!/usr/bin/env node
/**
 * Generate a valid, representative large synthetic PDF for reader QA.
 * Usage: node scripts/gen-representative-pdf.mjs <new-output.pdf> [pages=200]
 *
 * Every page contains selectable, unique text and its own uncompressed RGB
 * image (~1 MiB). Pages use a nested page tree and mixed portrait/landscape
 * geometry. No whitespace padding, network, real data or storage upload.
 * Refuses to overwrite an existing file; writes incrementally.
 */
import fs from "node:fs";
import path from "node:path";

const output = process.argv[2];
const count = Number(process.argv[3] ?? 200);
if (!output || !Number.isInteger(count) || count < 3 || count > 200) {
  console.error("Usage: node scripts/gen-representative-pdf.mjs <new-output.pdf> [pages=3..200]");
  process.exit(2);
}

const imageWidth = 768;
const imageHeight = 448;
const groupSize = 10;
const groups = Math.ceil(count / groupSize);
const pageId = (i) => 4 + groups + i * 3;
const groupId = (g) => 4 + g;
const lastId = pageId(count - 1) + 2;
const offsets = new Array(lastId + 1).fill(0);
const image = Buffer.alloc(imageWidth * imageHeight * 3);
let position = 0;
const fd = fs.openSync(output, "wx");

function write(value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "ascii") : value;
  let written = 0;
  while (written < bytes.length) {
    const n = fs.writeSync(fd, bytes, written, bytes.length - written);
    if (n <= 0) throw new Error("Short PDF write");
    written += n;
  }
  position += written;
}

function object(id, body) {
  offsets[id] = position;
  write(id + " 0 obj\n");
  write(body);
  write("\nendobj\n");
}

function stream(id, dictionary, bytes) {
  offsets[id] = position;
  write(id + " 0 obj\n<< " + dictionary + " /Length " + bytes.length + " >>\nstream\n");
  write(bytes);
  write("\nendstream\nendobj\n");
}

try {
  write("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Count " + count + " /Kids [" +
    Array.from({ length: groups }, (_, g) => groupId(g) + " 0 R").join(" ") + "] >>");
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let g = 0; g < groups; g++) {
    const start = g * groupSize;
    const n = Math.min(groupSize, count - start);
    const kids = Array.from({ length: n }, (_, i) => pageId(start + i) + " 0 R").join(" ");
    object(groupId(g), "<< /Type /Pages /Parent 2 0 R /Count " + n + " /Kids [" + kids + "] >>");
  }
  for (let i = 0; i < count; i++) {
    const id = pageId(i);
    const [w, h] = i % 3 === 0 ? [612, 792] : i % 3 === 1 ? [792, 612] : [500, 1000];
    const imageDrawWidth = w - 96;
    const imageDrawHeight = Math.round(imageDrawWidth * imageHeight / imageWidth);
    object(id, "<< /Type /Page /Parent " + groupId(Math.floor(i / groupSize)) +
      " 0 R /MediaBox [0 0 " + w + " " + h + "] /Resources << /Font << /F1 3 0 R >>" +
      " /XObject << /Im0 " + (id + 2) + " 0 R >> >> /Contents " + (id + 1) + " 0 R >>");
    const label = "MedVerse QA page " + (i + 1) + " of " + count;
    stream(id + 1, "", Buffer.from("BT /F1 18 Tf 48 " + (h - 48) +
      " Td (" + label + ") Tj ET\nq " + imageDrawWidth + " 0 0 " + imageDrawHeight +
      " 48 " + (h - 96 - imageDrawHeight) + " cm /Im0 Do Q\n", "ascii"));
    // Deterministic, clearly synthetic colour pattern; distinct image per page.
    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const at = (y * imageWidth + x) * 3;
        image[at] = (x + i * 17) & 255;
        image[at + 1] = (y + i * 31) & 255;
        image[at + 2] = ((x ^ y) + i * 7) & 255;
      }
    }
    stream(id + 2, "/Type /XObject /Subtype /Image /Width " + imageWidth +
      " /Height " + imageHeight + " /ColorSpace /DeviceRGB /BitsPerComponent 8", image);
  }
  const xref = position;
  write("xref\n0 " + offsets.length + "\n0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) {
    if (!offset) throw new Error("Missing object offset");
    write(String(offset).padStart(10, "0") + " 00000 n \n");
  }
  write("trailer\n<< /Size " + offsets.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
} catch (error) {
  fs.closeSync(fd);
  fs.unlinkSync(output);
  throw error;
}
fs.closeSync(fd);
console.log(JSON.stringify({ path: path.resolve(output), bytes: position, pages: count,
  imageBytesPerPage: image.length, pageTree: "nested", mixedGeometry: true }));
