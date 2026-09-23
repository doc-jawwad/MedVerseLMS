/**
 * S3-compatible SigV4 helpers for Cloudflare R2 (multipart + HEAD + range).
 * Builds on the same credentials/bucket as `presign.ts`. Study PDFs never
 * transit Next.js — the browser uploads parts to presigned URLs.
 */
import { createHmac, createHash } from "node:crypto";
import {
  getR2Config,
  isAllowedR2ObjectKey,
  type R2Config,
} from "@/lib/r2/presign";

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string
): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "s3"),
    "aws4_request"
  );
}

function resolveConfig(
  config?: R2Config
): R2Config | { error: "r2_not_configured" } {
  return config ?? getR2Config();
}

type QueryPairs = Array<[string, string]>;

function canonicalQuery(pairs: QueryPairs): string {
  const sorted = [...pairs].sort(([a], [b]) => a.localeCompare(b));
  return sorted
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Query-string presign for UploadPart / single PUT with optional Content-Type. */
export function presignR2Upload(options: {
  method: "PUT";
  key: string;
  expiresSeconds?: number;
  /** Extra query params (e.g. partNumber, uploadId). */
  query?: Record<string, string>;
  /** If set, browser MUST send this Content-Type; it is signed. */
  contentType?: string;
  now?: Date;
  config?: R2Config;
}): { url: string } | { error: string } {
  if (!isAllowedR2ObjectKey(options.key)) return { error: "invalid_object_key" };
  const config = resolveConfig(options.config);
  if ("error" in config) return config;
  const expires = options.expiresSeconds ?? 3600;
  if (expires <= 0 || expires > 3600) return { error: "invalid_expires" };

  const { amzDate: date, dateStamp } = amzDate(options.now ?? new Date());
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;

  const signedHeaderNames = options.contentType
    ? "content-type;host"
    : "host";
  const query: QueryPairs = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", signedHeaderNames],
    ...Object.entries(options.query ?? {}),
  ];
  const canonicalQueryStr = canonicalQuery(query);
  const canonicalUri = `/${encodePath(`${config.bucket}/${options.key}`)}`;
  const canonicalHeaders = options.contentType
    ? `content-type:${options.contentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQueryStr,
    canonicalHeaders,
    signedHeaderNames,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    stringToSign
  ).toString("hex");
  return {
    url: `${config.endpoint}${canonicalUri}?${canonicalQueryStr}&X-Amz-Signature=${signature}`,
  };
}

async function signedS3Fetch(options: {
  method: string;
  key: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  config?: R2Config;
}): Promise<Response | { error: string }> {
  if (!isAllowedR2ObjectKey(options.key)) return { error: "invalid_object_key" };
  const config = resolveConfig(options.config);
  if ("error" in config) return config;

  const now = new Date();
  const { amzDate: date, dateStamp } = amzDate(now);
  const host = new URL(config.endpoint).host;
  const payloadHash = options.body
    ? sha256Hex(options.body)
    : "UNSIGNED-PAYLOAD";

  const headerMap: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
    ...(options.headers ?? {}),
  };
  const signedHeaderKeys = Object.keys(headerMap)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headerMap[k].trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderKeys.join(";");

  const queryPairs: QueryPairs = Object.entries(options.query ?? {});
  const canonicalQueryStr = canonicalQuery(queryPairs);
  const canonicalUri = `/${encodePath(`${config.bucket}/${options.key}`)}`;
  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQueryStr,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    stringToSign
  ).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url =
    `${config.endpoint}${canonicalUri}` +
    (canonicalQueryStr ? `?${canonicalQueryStr}` : "");

  const bodyInit =
    options.body == null
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : new Uint8Array(options.body);
  const res = await fetch(url, {
    method: options.method,
    headers: {
      ...Object.fromEntries(
        Object.entries(headerMap).filter(([k]) => k !== "host")
      ),
      Authorization: authorization,
    },
    body: bodyInit,
  });
  return res;
}

export async function createMultipartUpload(options: {
  key: string;
  contentType: string;
  config?: R2Config;
}): Promise<{ uploadId: string } | { error: string }> {
  const res = await signedS3Fetch({
    method: "POST",
    key: options.key,
    query: { uploads: "" },
    headers: { "content-type": options.contentType },
    body: null,
    config: options.config,
  });
  if ("error" in res) return res;
  if (!res.ok) {
    return { error: `r2_multipart_create_failed:${res.status}` };
  }
  const xml = await res.text();
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!match?.[1]) return { error: "r2_multipart_create_parse" };
  return { uploadId: match[1] };
}

export async function completeMultipartUpload(options: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  config?: R2Config;
}): Promise<{ error?: string }> {
  const sorted = [...options.parts].sort((a, b) => a.partNumber - b.partNumber);
  const body =
    `<CompleteMultipartUpload>` +
    sorted
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`
      )
      .join("") +
    `</CompleteMultipartUpload>`;
  const res = await signedS3Fetch({
    method: "POST",
    key: options.key,
    query: { uploadId: options.uploadId },
    headers: { "content-type": "application/xml" },
    body,
    config: options.config,
  });
  if ("error" in res) return res;
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    return { error: `r2_multipart_complete_failed:${res.status}:${detail}` };
  }
  return {};
}

export async function abortMultipartUpload(options: {
  key: string;
  uploadId: string;
  config?: R2Config;
}): Promise<{ error?: string }> {
  const res = await signedS3Fetch({
    method: "DELETE",
    key: options.key,
    query: { uploadId: options.uploadId },
    body: null,
    config: options.config,
  });
  if ("error" in res) return res;
  if (res.ok || res.status === 404) return {};
  return { error: `r2_multipart_abort_failed:${res.status}` };
}

export async function headR2Object(options: {
  key: string;
  config?: R2Config;
}): Promise<
  | { contentLength: number; contentType: string; etag: string | null }
  | { error: string }
> {
  const res = await signedS3Fetch({
    method: "HEAD",
    key: options.key,
    body: null,
    config: options.config,
  });
  if ("error" in res) return res;
  if (!res.ok) return { error: `r2_head_failed:${res.status}` };
  const len = Number(res.headers.get("content-length") ?? "0");
  return {
    contentLength: Number.isFinite(len) ? len : 0,
    contentType: res.headers.get("content-type") || "application/octet-stream",
    etag: res.headers.get("etag"),
  };
}

/** Efficient range read — used only for PDF magic-byte checks. */
export async function getR2ObjectRange(options: {
  key: string;
  start: number;
  end: number;
  config?: R2Config;
}): Promise<{ body: Buffer } | { error: string }> {
  const res = await signedS3Fetch({
    method: "GET",
    key: options.key,
    headers: { Range: `bytes=${options.start}-${options.end}` },
    body: null,
    config: options.config,
  });
  if ("error" in res) return res;
  if (res.status !== 206 && res.status !== 200) {
    return { error: `r2_range_failed:${res.status}` };
  }
  return { body: Buffer.from(await res.arrayBuffer()) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
