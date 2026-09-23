import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openStudyPdfUploadSession,
  sealStudyPdfUploadSession,
} from "../../src/lib/study/upload-session.ts";

describe("study pdf upload session", () => {
  it("round-trips a sealed token", () => {
    process.env.STUDY_UPLOAD_SESSION_SECRET = "unit-test-secret";
    const sealed = sealStudyPdfUploadSession({
      v: 1,
      key: "study-content/t/u/abc",
      uploadId: "up-1",
      folderId: "11111111-1111-1111-1111-111111111111",
      mode: "multipart",
      declaredSize: 100,
      contentType: "application/pdf",
      uid: "22222222-2222-2222-2222-222222222222",
      partSize: 8 * 1024 * 1024,
      partCount: 2,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    assert.ok(!("error" in sealed));
    const opened = openStudyPdfUploadSession(sealed.token);
    assert.ok(!("error" in opened));
    assert.equal(opened.key, "study-content/t/u/abc");
    assert.equal(opened.mode, "multipart");
  });

  it("rejects tampered tokens", () => {
    process.env.STUDY_UPLOAD_SESSION_SECRET = "unit-test-secret";
    const sealed = sealStudyPdfUploadSession({
      v: 1,
      key: "study-content/t/u/abc",
      uploadId: null,
      folderId: "11111111-1111-1111-1111-111111111111",
      mode: "put",
      declaredSize: 10,
      contentType: "application/pdf",
      uid: "22222222-2222-2222-2222-222222222222",
      partSize: 10,
      partCount: 1,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    assert.ok(!("error" in sealed));
    const bad = sealed.token.slice(0, -4) + "xxxx";
    const opened = openStudyPdfUploadSession(bad);
    assert.deepEqual(opened, { error: "upload_session_invalid" });
  });
});
