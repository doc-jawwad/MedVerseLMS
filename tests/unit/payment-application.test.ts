import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canStudentEditApplication,
  isPrivatePaymentScreenshotKey,
  isTerminalApplicationStatus,
  screenshotObjectKeyLooksPublic,
  validatePaymentAmount,
  validatePaymentScreenshotFile,
} from "../../src/lib/payments/application.ts";

describe("application status handling", () => {
  it("allows edit only while pending", () => {
    assert.equal(canStudentEditApplication("pending"), true);
    assert.equal(canStudentEditApplication("approved"), false);
    assert.equal(canStudentEditApplication("rejected"), false);
    assert.equal(canStudentEditApplication("cancelled"), false);
  });

  it("treats approved, rejected, and cancelled as terminal", () => {
    assert.equal(isTerminalApplicationStatus("pending"), false);
    assert.equal(isTerminalApplicationStatus("approved"), true);
    assert.equal(isTerminalApplicationStatus("rejected"), true);
    assert.equal(isTerminalApplicationStatus("cancelled"), true);
  });
});

describe("amount validation", () => {
  it("rejects zero, negative, and non-numeric amounts", () => {
    assert.equal(validatePaymentAmount(0), "invalid_amount");
    assert.equal(validatePaymentAmount(-1), "invalid_amount");
    assert.equal(validatePaymentAmount("abc"), "invalid_amount");
    assert.equal(validatePaymentAmount(null), "invalid_amount");
  });

  it("accepts a positive amount", () => {
    assert.equal(validatePaymentAmount(1500), null);
    assert.equal(validatePaymentAmount("1500"), null);
  });
});

describe("upload/file validation", () => {
  it("accepts jpeg/png/webp within 5MB", () => {
    assert.equal(
      validatePaymentScreenshotFile({ type: "image/jpeg", size: 1024 }),
      null
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "image/png", size: 1024 }),
      null
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "image/webp", size: 1024 }),
      null
    );
  });

  it("rejects pdf, empty, and oversized files", () => {
    assert.equal(
      validatePaymentScreenshotFile({ type: "application/pdf", size: 1024 }),
      "invalid_screenshot_type"
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "image/jpeg", size: 0 }),
      "invalid_screenshot_size"
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "image/jpeg",
        size: 5 * 1024 * 1024 + 1,
      }),
      "invalid_screenshot_size"
    );
  });
});

describe("screenshot object key", () => {
  it("rejects public URLs and accepts payment-proofs keys", () => {
    assert.equal(
      screenshotObjectKeyLooksPublic("https://cdn.example/proof.png"),
      true
    );
    assert.equal(
      isPrivatePaymentScreenshotKey("https://cdn.example/proof.png"),
      false
    );
    const key =
      "payment-proofs/00000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    assert.equal(isPrivatePaymentScreenshotKey(key), true);
    assert.equal(
      isPrivatePaymentScreenshotKey(key, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      true
    );
    assert.equal(
      isPrivatePaymentScreenshotKey(key, "cccccccc-cccc-cccc-cccc-cccccccccccc"),
      false
    );
  });
});
