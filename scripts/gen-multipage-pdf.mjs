#!/usr/bin/env node
/**
 * Generate a small multi-page synthetic PDF (not committed as a huge binary).
 * Usage: node scripts/gen-multipage-pdf.mjs <path> [pageCount=40]
 *
 * Each page has visible text "MedVerse page N of TOTAL" for search/jump tests.
 */
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const pageCount = Math.max(3, Math.min(200, Number(process.argv[3] || 40)));
if (!out) {
  console.error("Usage: node scripts/gen-multipage-pdf.mjs <path> [pageCount]");
  process.exit(2);
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const objs = [];
const add = (body) => {
  objs.push(body);
  return objs.length;
};

const kids = [];
const pageIds = [];
for (let i = 1; i <= pageCount; i++) {
  const label = esc(`MedVerse page ${i} of ${pageCount}`);
  const stream = `BT /F1 18 Tf 72 720 Td (${label}) Tj ET`;
  const streamId = add(
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  );
  const pageId = add(
    `<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${"FONT"} 0 R >> >> >>`
  );
  pageIds.push(pageId);
  kids.push(`${pageId} 0 R`);
}

const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pagesId = add(
  `<< /Type /Pages /Kids [ ${kids.join(" ")} ] /Count ${pageCount} >>`
);
const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

// Resolve forward refs
for (let i = 0; i < objs.length; i++) {
  objs[i] = objs[i]
    .replaceAll("PAGES", `${pagesId} 0 R`)
    .replaceAll("FONT", String(fontId));
}

let body = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objs.length; i++) {
  offsets.push(Buffer.byteLength(body));
  body += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(body);
body += `xref\n0 ${objs.length + 1}\n`;
body += "0000000000 65535 f \n";
for (let i = 1; i <= objs.length; i++) {
  body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
body += `trailer<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\n`;
body += `startxref\n${xrefStart}\n%%EOF\n`;

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, body);
console.log(
  JSON.stringify({
    path: path.resolve(out),
    bytes: Buffer.byteLength(body),
    pages: pageCount,
  })
);
