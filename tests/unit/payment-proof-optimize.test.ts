import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optimizePaymentProofToWebp } from "../../src/lib/payments/optimize-screenshot.ts";

async function jpegFixture(width = 120, height = 80): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 160 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function pngFixture(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

describe("optimizePaymentProofToWebp", () => {
  it("converts JPEG to canonical WebP and shrinks large inputs", async () => {
    const input = await jpegFixture(2400, 1800);
    const out = await optimizePaymentProofToWebp(input);
    assert.equal("error" in out, false);
    if ("error" in out) return;
    assert.equal(out.contentType, "image/webp");
    assert.ok(out.outputBytes > 20);
    assert.ok(out.width <= 2000);
    assert.ok(out.height <= 2000);
    assert.ok(out.outputBytes < out.inputBytes);
    // WebP RIFF header
    assert.equal(out.buffer.subarray(0, 4).toString("ascii"), "RIFF");
  });

  it("converts PNG to WebP", async () => {
    const input = await pngFixture();
    const out = await optimizePaymentProofToWebp(input);
    assert.equal("error" in out, false);
    if ("error" in out) return;
    assert.equal(out.contentType, "image/webp");
  });

  it("rejects empty and non-image payloads", async () => {
    assert.deepEqual(await optimizePaymentProofToWebp(Buffer.alloc(0)), {
      error: "invalid_screenshot_size",
    });
    assert.deepEqual(
      await optimizePaymentProofToWebp(Buffer.from("%PDF-1.4 fake")),
      { error: "invalid_screenshot_type" }
    );
  });
});
