import { createHmac, createHash } from "node:crypto";

const DEFAULT_EXPIRES_SECONDS = 300;
const DEFAULT_PREFIX = "payment-proofs";

export type R2Method = "GET" | "PUT";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
};

function isProductionEnv(): boolean {
  return (process.env.MEDVERSE_ENV?.trim() ?? "") === "production";
}

/**
 * Payment proofs must use a dedicated bucket. In production, never fall back to
 * R2_BUCKET (that name is for encrypted DB backups on the host backup job).
 * Non-production may still use R2_BUCKET for a shared private bucket.
 */
export function resolvePaymentR2Bucket(): string {
  const paymentBucket = process.env.R2_PAYMENT_BUCKET?.trim() ?? "";
  if (paymentBucket) return paymentBucket;
  if (isProductionEnv()) return "";
  return process.env.R2_BUCKET?.trim() ?? "";
}

export function getR2Config(): R2Config | { error: "r2_not_configured" } {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = resolvePaymentR2Bucket();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { error: "r2_not_configured" };
  }
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region: "auto",
  };
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodePath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function paymentScreenshotPrefix(): string {
  return process.env.R2_PAYMENT_PREFIX?.trim() || DEFAULT_PREFIX;
}

export function presignR2Object(options: {
  method: R2Method;
  key: string;
  expiresSeconds?: number;
  now?: Date;
  config?: R2Config;
}): { url: string } | { error: string } {
  if (!options.key.startsWith(`${paymentScreenshotPrefix()}/`)) {
    return { error: "invalid_screenshot_object_key" };
  }
  const config = options.config ?? getR2Config();
  if ("error" in config) return config;
  const expires = options.expiresSeconds ?? DEFAULT_EXPIRES_SECONDS;
  if (expires <= 0 || expires > 3600) return { error: "invalid_expires" };

  const { amzDate: date, dateStamp } = amzDate(options.now ?? new Date());
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  query.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = query
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalUri = `/${encodePath(`${config.bucket}/${options.key}`)}`;
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region),
      "s3"
    ),
    "aws4_request"
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");
  const url = `${config.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url };
}

export async function putR2Object(options: {
  key: string;
  body: Buffer;
  contentType: string;
  config?: R2Config;
}): Promise<{ error?: string }> {
  const signed = presignR2Object({
    method: "PUT",
    key: options.key,
    config: options.config,
  });
  if ("error" in signed) return signed;
  const res = await fetch(signed.url, {
    method: "PUT",
    body: new Uint8Array(options.body),
  });
  if (!res.ok) return { error: "r2_upload_failed" };
  return {};
}
