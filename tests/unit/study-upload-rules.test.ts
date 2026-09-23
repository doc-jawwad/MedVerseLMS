import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStudyPdfFile,
  isStudyPdfMeta,
} from "../../src/lib/study/upload-rules.ts";
import {
  chooseStudyPdfParting,
  STUDY_PDF_MULTIPART_THRESHOLD_BYTES,
} from "../../src/lib/study/upload-session.ts";

describe("study upload rules", () => {
  it("accepts large PDFs (no artificial max)", () => {
    assert.equal(
      isStudyPdfMeta({
        type: "application/pdf",
        size: 1024 * 1024 * 1024,
        name: "big.pdf",
      }),
      null
    );
    assert.equal(
      isStudyPdfFile({ type: "application/pdf", size: 200 * 1024 * 1024 }),
      null
    );
  });

  it("rejects empty and non-PDF", () => {
    assert.equal(
      isStudyPdfMeta({ type: "application/pdf", size: 0, name: "a.pdf" }),
      "pdf_empty"
    );
    assert.equal(
      isStudyPdfMeta({ type: "text/plain", size: 100, name: "a.txt" }),
      "pdf_type_invalid"
    );
  });

  it("allows empty MIME when name ends with .pdf", () => {
    assert.equal(
      isStudyPdfMeta({ type: "", size: 10, name: "notes.PDF" }),
      null
    );
  });
});

describe("study pdf parting", () => {
  it("uses single PUT below threshold", () => {
    const p = chooseStudyPdfParting(STUDY_PDF_MULTIPART_THRESHOLD_BYTES - 1);
    assert.equal(p.mode, "put");
    assert.equal(p.partCount, 1);
  });

  it("uses multipart at/above threshold", () => {
    const p = chooseStudyPdfParting(STUDY_PDF_MULTIPART_THRESHOLD_BYTES);
    assert.equal(p.mode, "multipart");
    assert.ok(p.partCount >= 2);
    assert.ok(p.partSize >= 8 * 1024 * 1024);
  });

  it("keeps part count under 9000 for 1 GiB+", () => {
    const p = chooseStudyPdfParting(5 * 1024 * 1024 * 1024);
    assert.equal(p.mode, "multipart");
    assert.ok(p.partCount <= 9000);
  });
});
