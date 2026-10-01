import sharp from "sharp";

/** Max decoded edge length — keeps admin receipt readability without huge objects. */
export const PAYMENT_PROOF_MAX_EDGE_PX = 2000;

/** WebP quality: readable bank/transfer screenshots, not archival RAW. */
export const PAYMENT_PROOF_WEBP_QUALITY = 82;

export type OptimizedPaymentProof = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  inputBytes: number;
  outputBytes: number;
};

/**
 * Decode an uploaded payment-proof image and emit a metadata-stripped WebP.
 * Rejects non-images and decode failures (including MIME spoofing).
 */
export async function optimizePaymentProofToWebp(
  input: Buffer
): Promise<OptimizedPaymentProof | { error: string }> {
  if (!input || input.length === 0) {
    return { error: "invalid_screenshot_size" };
  }

  try {
    const pipeline = sharp(input, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    }).rotate(); // honor EXIF orientation, then strip metadata on encode

    const meta = await pipeline.metadata();
    if (!meta.format || meta.format === "svg" || meta.format === "pdf") {
      return { error: "invalid_screenshot_type" };
    }

    const buffer = await pipeline
      .resize({
        width: PAYMENT_PROOF_MAX_EDGE_PX,
        height: PAYMENT_PROOF_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality: PAYMENT_PROOF_WEBP_QUALITY,
        effort: 4,
        alphaQuality: 80,
      })
      .toBuffer({ resolveWithObject: true });

    const width = buffer.info.width || 0;
    const height = buffer.info.height || 0;
    if (width < 1 || height < 1 || buffer.data.length < 1) {
      return { error: "invalid_screenshot_type" };
    }

    return {
      buffer: buffer.data,
      contentType: "image/webp",
      width,
      height,
      inputBytes: input.length,
      outputBytes: buffer.data.length,
    };
  } catch {
    return { error: "invalid_screenshot_type" };
  }
}
