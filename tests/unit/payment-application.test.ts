import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAYMENT_SCREENSHOT_MAX_BYTES,
  canStudentEditApplication,
  isPrivatePaymentScreenshotKey,
  isTerminalApplicationStatus,
  resolvePaymentScreenshotContentType,
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
  it("accepts jpeg/png/webp within the size ceiling", () => {
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

  it("accepts mobile MIME aliases and empty/octet-stream with image extensions", () => {
    assert.equal(
      resolvePaymentScreenshotContentType("image/jpg", "shot.jpg"),
      "image/jpeg"
    );
    assert.equal(
      resolvePaymentScreenshotContentType("image/pjpeg", "shot.jpg"),
      "image/jpeg"
    );
    assert.equal(
      resolvePaymentScreenshotContentType("", "JazzCash.png"),
      "image/png"
    );
    assert.equal(
      resolvePaymentScreenshotContentType(
        "application/octet-stream",
        "receipt.JPEG"
      ),
      "image/jpeg"
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "",
        size: 2048,
        name: "easypaisa.webp",
      }),
      null
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "application/octet-stream",
        size: 2048,
        name: "proof.jpg",
      }),
      null
    );
  });

  it("rejects HEIC with a dedicated code and still rejects pdf/empty/oversized", () => {
    assert.equal(
      validatePaymentScreenshotFile({
        type: "image/heic",
        size: 1024,
        name: "IMG_001.HEIC",
      }),
      "heic_not_supported"
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "",
        size: 1024,
        name: "receipt.heif",
      }),
      "heic_not_supported"
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "application/pdf", size: 1024 }),
      "invalid_screenshot_type"
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "", size: 1024, name: "notes.txt" }),
      "invalid_screenshot_type"
    );
    assert.equal(
      validatePaymentScreenshotFile({ type: "image/jpeg", size: 0 }),
      "invalid_screenshot_size"
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "image/jpeg",
        size: PAYMENT_SCREENSHOT_MAX_BYTES + 1,
      }),
      "invalid_screenshot_size"
    );
    assert.equal(
      validatePaymentScreenshotFile({
        type: "image/jpeg",
        size: PAYMENT_SCREENSHOT_MAX_BYTES,
      }),
      null
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
