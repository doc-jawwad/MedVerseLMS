import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STUDY_PDF_MAX_BYTES,
  isStudyPdfFile,
} from "../../src/lib/study/upload-rules.ts";

describe("study upload rules", () => {
  it("caps study PDFs at 25MB", () => {
    assert.equal(STUDY_PDF_MAX_BYTES, 25 * 1024 * 1024);
  });

  it("accepts PDFs within the size limit", () => {
    assert.equal(
      isStudyPdfFile({ type: "application/pdf", size: STUDY_PDF_MAX_BYTES }),
      null
    );
  });

  it("rejects oversize PDFs", () => {
    assert.equal(
      isStudyPdfFile({
        type: "application/pdf",
        size: STUDY_PDF_MAX_BYTES + 1,
      }),
      "pdf_too_large"
    );
  });
});
