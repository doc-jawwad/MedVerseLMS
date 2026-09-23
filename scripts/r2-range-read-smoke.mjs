#!/usr/bin/env node
/**
 * Staging range-read smoke against a known material ID (env STUDY_PDF_MATERIAL_ID)
 * or creates nothing — expects a session cookie jar is not available, so this
 * script instead verifies R2 range streaming helpers with host credentials.
 *
 * Usage on VPS:
 *   set -a; source /etc/medverse-staging/nextjs.env; set +a
 *   node /tmp/r2-range-read-smoke.mjs [bytes]
 */
import { createHmac, createHash, randomUUID } from "node:crypto";

function req(name) {
  const v = process.env[name]?.trim() ?? "";
  if (!v) throw new Error(`missing_${name}`);
  return v;
}
function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function encodePath(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}
function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}
function signingKey(secret, dateStamp, region) {
  return hmac(
    hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"),
    "aws4_request"
  );
}
function cq(pairs) {
  return [...pairs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

const config = {
  accessKeyId: req("R2_ACCESS_KEY_ID"),
  secretAccessKey: req("R2_SECRET_ACCESS_KEY"),
  bucket: process.env.R2_PAYMENT_BUCKET?.trim() || req("R2_BUCKET"),
  endpoint: `https://${req("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  region: "auto",
};

function presignGet(key) {
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const pairs = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", "600"],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = cq(pairs);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const cr = ["GET", uri, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join(
    "\n"
  );
  const sts = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(cr),
  ].join("\n");
  const sig = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    sts
  ).toString("hex");
  return `${config.endpoint}${uri}?${query}&X-Amz-Signature=${sig}`;
}

const bytes = Number(process.argv[2] ?? String(50 * 1024 * 1024));
const key = `study-content/smoke/range-${randomUUID()}.pdf`;
const body = Buffer.alloc(bytes);
body.write("%PDF-1.4\n");
body.write("%%EOF\n", bytes - 6);

// Upload via single PUT or multipart using aws-style — reuse put with signed URL
function presignPut(key) {
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const contentType = "application/pdf";
  const pairs = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", "900"],
    ["X-Amz-SignedHeaders", "content-type;host"],
  ];
  const query = cq(pairs);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const ch = `content-type:${contentType}\nhost:${host}\n`;
  const cr = ["PUT", uri, query, ch, "content-type;host", "UNSIGNED-PAYLOAD"].join(
    "\n"
  );
  const sts = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(cr),
  ].join("\n");
  const sig = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    sts
  ).toString("hex");
  return `${config.endpoint}${uri}?${query}&X-Amz-Signature=${sig}`;
}

const mem0 = process.memoryUsage().heapUsed;
const putUrl = presignPut(key);
const put = await fetch(putUrl, {
  method: "PUT",
  headers: { "Content-Type": "application/pdf" },
  body,
});
if (!put.ok) throw new Error(`put ${put.status}`);

const getUrl = presignGet(key);
const range = await fetch(getUrl, {
  headers: { Range: "bytes=0-7" },
});
const rangeBuf = Buffer.from(await range.arrayBuffer());
const fullStream = await fetch(getUrl);
let streamed = 0;
const reader = fullStream.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  streamed += value.byteLength;
}
const mem1 = process.memoryUsage().heapUsed;

// cleanup
await fetch(presignGet(key).replace("?", "?x=1&").replace("X-Amz-Algorithm", "noop"), {
  method: "DELETE",
}).catch(() => undefined);
// proper delete via signed DELETE
{
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const pairs = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", "300"],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = cq(pairs);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const cr = ["DELETE", uri, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join(
    "\n"
  );
  const sts = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(cr),
  ].join("\n");
  const sig = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    sts
  ).toString("hex");
  await fetch(`${config.endpoint}${uri}?${query}&X-Amz-Signature=${sig}`, {
    method: "DELETE",
  });
}

console.log(
  JSON.stringify({
    bytes,
    rangeStatus: range.status,
    magic: rangeBuf.toString("utf8"),
    streamed,
    heapDeltaMb: Number(((mem1 - mem0) / (1024 * 1024)).toFixed(2)),
    ok:
      (range.status === 206 || range.status === 200) &&
      rangeBuf.toString("utf8").startsWith("%PDF-") &&
      streamed === bytes,
  })
);
