#!/usr/bin/env node
import { createHmac, createHash, randomUUID } from "node:crypto";

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}
/** AWS-style encode: encodeURIComponent but keep -_.~ and restore ~ */
function awsEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

const config = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: "auto",
};

// Create MPU with header auth (known working pattern from aws cli)
async function createMpu(key) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const headerMap = {
    host,
    "content-type": "application/pdf",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headerMap[k]}\n`)
    .join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const cq = "uploads=";
  const uri = `/${config.bucket}/${key}`
    .split("/")
    .map((p, i) => (i === 0 ? "" : awsEncode(p)))
    .join("/");
  // fix uri build
  const uri2 =
    "/" +
    `${config.bucket}/${key}`
      .split("/")
      .map((p) => awsEncode(p))
      .join("/");
  const cr = [
    "POST",
    uri2,
    cq,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const sts = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(cr),
  ].join("\n");
  let k = hmacSha256("AWS4" + config.secretAccessKey, dateStamp);
  k = hmacSha256(k, config.region);
  k = hmacSha256(k, "s3");
  k = hmacSha256(k, "aws4_request");
  const sig = createHmac("sha256", k).update(sts, "utf8").digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  const res = await fetch(`${config.endpoint}${uri2}?uploads=`, {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: auth,
    },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`create ${res.status} ${xml}`);
  return xml.match(/<UploadId>([^<]+)<\/UploadId>/)[1];
}

function presignPart(key, uploadId) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const pairs = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", "900"],
    ["X-Amz-SignedHeaders", "host"],
    ["partNumber", "1"],
    ["uploadId", uploadId],
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const cq = pairs.map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).join("&");
  const uri =
    "/" +
    `${config.bucket}/${key}`
      .split("/")
      .map((p) => awsEncode(p))
      .join("/");
  const canonicalHeaders = `host:${host}\n`;
  const cr = ["PUT", uri, cq, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join(
    "\n"
  );
  console.log("CR_HASH", sha256Hex(cr));
  const sts = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(cr),
  ].join("\n");
  let k = hmacSha256("AWS4" + config.secretAccessKey, dateStamp);
  k = hmacSha256(k, config.region);
  k = hmacSha256(k, "s3");
  k = hmacSha256(k, "aws4_request");
  const sig = createHmac("sha256", k).update(sts, "utf8").digest("hex");
  return `${config.endpoint}${uri}?${cq}&X-Amz-Signature=${sig}`;
}

const key = `study-content/smoke/${randomUUID()}.pdf`;
const uploadId = await createMpu(key);
console.log("uploadId", uploadId.length);
const url = presignPart(key, uploadId);
const body = Buffer.alloc(8 * 1024 * 1024, 0x41);
body.write("%PDF-1.4\n");
const put = await fetch(url, { method: "PUT", body });
console.log("PART", put.status, (await put.text()).slice(0, 300));
