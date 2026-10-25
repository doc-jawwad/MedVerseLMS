import "server-only";

import { createHmac, createHash } from "node:crypto";

const DEFAULT_EXPIRES_SECONDS = 300;
const DEFAULT_PREFIX = "payment-proofs";

export type R2Method = "GET" | "PUT" | "DELETE";

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

export function studyContentPrefix(): string {
  return process.env.R2_STUDY_PREFIX?.trim() || "study-content";
}

export function isAllowedR2ObjectKey(key: string): boolean {
  if (!key || key.includes("://") || key.includes("..") || /\s/.test(key)) {
    return false;
  }
  return (
    key.startsWith(`${paymentScreenshotPrefix()}/`) ||
    key.startsWith(`${studyContentPrefix()}/`)
  );
}

export function presignR2Object(options: {
  method: R2Method;
  key: string;
  expiresSeconds?: number;
  now?: Date;
  config?: R2Config;
}): { url: string } | { error: string } {
  if (!isAllowedR2ObjectKey(options.key)) {
    return { error: "invalid_object_key" };
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
  const contentType =
    options.contentType?.trim() || "application/octet-stream";
  try {
    // Content-Type is not in the signed header set (host-only) — safe to send.
    const res = await fetch(signed.url, {
      method: "PUT",
      body: new Uint8Array(options.body),
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) return { error: "r2_upload_failed" };
    return {};
  } catch {
    // Network / TLS / DNS failures must not throw out of Server Actions.
    return { error: "r2_upload_failed" };
  }
}

/** Best-effort delete of a private payment-proof object. 404 is treated as success. */
export async function deleteR2Object(options: {
  key: string;
  config?: R2Config;
}): Promise<{ error?: string }> {
  const signed = presignR2Object({
    method: "DELETE",
    key: options.key,
    config: options.config,
  });
  if ("error" in signed) return signed;
  const res = await fetch(signed.url, { method: "DELETE" });
  if (res.ok || res.status === 404) return {};
  return { error: "r2_delete_failed" };
}

export async function getR2Object(options: {
  key: string;
  config?: R2Config;
}): Promise<{ body: Buffer; contentType: string } | { error: string }> {
  const signed = presignR2Object({
    method: "GET",
    key: options.key,
    config: options.config,
  });
  if ("error" in signed) return signed;
  const res = await fetch(signed.url, { method: "GET" });
  if (!res.ok) return { error: "r2_download_failed" };
  const body = Buffer.from(await res.arrayBuffer());
  const contentType =
    res.headers.get("content-type") || "application/octet-stream";
  return { body, contentType };
}

/**
 * Stream (or range) an R2 object without buffering the full body in Node.
 * Pass through upstream status (200/206) and Content-* / Accept-Ranges.
 */
export async function fetchR2ObjectStream(options: {
  key: string;
  rangeHeader?: string | null;
  config?: R2Config;
}): Promise<Response | { error: string }> {
  const signed = presignR2Object({
    method: "GET",
    key: options.key,
    expiresSeconds: 600,
    config: options.config,
  });
  if ("error" in signed) return signed;
  const headers: HeadersInit = {};
  if (options.rangeHeader) {
    headers.Range = options.rangeHeader;
  }
  const res = await fetch(signed.url, { method: "GET", headers });
  if (!res.ok && res.status !== 206) {
    return { error: `r2_download_failed:${res.status}` };
  }
  return res;
}

export async function headR2ObjectViaPresign(options: {
  key: string;
  config?: R2Config;
}): Promise<
  | { contentLength: number; contentType: string; acceptRanges: boolean }
  | { error: string }
> {
  const signed = presignR2Object({
    method: "GET",
    key: options.key,
    expiresSeconds: 120,
    config: options.config,
  });
  if ("error" in signed) return signed;
  // Prefer HEAD against the object via unsigned Range probe on GET 0-0 when
  // S3 HEAD through query-presign is awkward — use bytes=0-0 for length.
  const res = await fetch(signed.url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  if (res.status !== 206 && res.status !== 200) {
    return { error: `r2_head_failed:${res.status}` };
  }
  const contentRange = res.headers.get("content-range");
  let contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)\s*$/);
    if (m?.[1]) contentLength = Number(m[1]);
  }
  // Drain tiny body so the connection can close.
  await res.arrayBuffer().catch(() => undefined);
  return {
    contentLength: Number.isFinite(contentLength) ? contentLength : 0,
    contentType: res.headers.get("content-type") || "application/pdf",
    acceptRanges: true,
  };
}
