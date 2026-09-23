/**
 * Cloudflare R2 CORS for direct browser PUT / multipart UploadPart.
 *
 * Apply to the private study/payment objects bucket (staging + prod buckets
 * separately). Do NOT make the bucket public — only CORS + temporary
 * presigned URLs.
 *
 * Origins must match deployed MedVerse hosts only.
 *
 * Apply via Cloudflare dashboard → R2 → bucket → Settings → CORS policy,
 * or S3 PutBucketCors with the same credentials as MedVerse.
 *
 * AbortIncompleteMultipartUpload lifecycle (recommended safety net):
 * abort incomplete MPU after 7 days so abandoned sessions do not linger.
 */
export const MEDVERSE_R2_CORS_RULES = [
  {
    AllowedOrigins: [
      "https://staging.medversepk.com",
      "https://lms.medversepk.com",
    ],
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: [
      "Content-Type",
      "Content-Length",
      "x-amz-content-sha256",
      "x-amz-date",
      "Authorization",
    ],
    ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
    MaxAgeSeconds: 3600,
  },
] as const;

/** JSON suitable for `wrangler r2 bucket cors put` / dashboard paste. */
export function medverseR2CorsJson(): string {
  return JSON.stringify(MEDVERSE_R2_CORS_RULES, null, 2);
}
