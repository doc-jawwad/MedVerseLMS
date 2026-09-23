#!/usr/bin/env node
/** Quick multipart create+one-part debug. */
import { createHmac, createHash, randomUUID } from "node:crypto";

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
function canonicalQuery(pairs) {
  return [...pairs]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

const config = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: "auto",
};
const key = `study-content/smoke/${randomUUID()}.pdf`;

async function signedFetch(method, key, query, headers, body) {
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const payloadHash = body ? sha256Hex(body) : "UNSIGNED-PAYLOAD";
  const headerMap = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  for (const [k, v] of Object.entries(headers ?? {})) {
    headerMap[k.toLowerCase()] = v;
  }
  const keys = Object.keys(headerMap).sort();
  const ch = keys.map((k) => `${k}:${headerMap[k].trim()}\n`).join("");
  const sh = keys.join(";");
  const cq = canonicalQuery(Object.entries(query ?? {}));
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const cr = [method, uri, cq, ch, sh, payloadHash].join("\n");
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
  const auth = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request, SignedHeaders=${sh}, Signature=${sig}`;
  const url = `${config.endpoint}${uri}${cq ? `?${cq}` : ""}`;
  return fetch(url, {
    method,
    headers: {
      ...Object.fromEntries(
        Object.entries(headerMap).filter(([k]) => k !== "host")
      ),
      Authorization: auth,
    },
    body: body == null ? undefined : new Uint8Array(body),
  });
}

function presignPart(uploadId, partNumber) {
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const q = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", "900"],
    ["X-Amz-SignedHeaders", "host"],
    ["partNumber", String(partNumber)],
    ["uploadId", uploadId],
  ];
  const cq = canonicalQuery(q);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const ch = `host:${host}\n`;
  const cr = ["PUT", uri, cq, ch, "host", "UNSIGNED-PAYLOAD"].join("\n");
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
  return `${config.endpoint}${uri}?${cq}&X-Amz-Signature=${sig}`;
}

const create = await signedFetch(
  "POST",
  key,
  { uploads: "" },
  { "content-type": "application/pdf" },
  null
);
const xml = await create.text();
console.log("CREATE", create.status, xml.slice(0, 400));
const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
if (!uploadId) process.exit(2);
const url = presignPart(uploadId, 1);
const body = Buffer.alloc(8 * 1024 * 1024, 0x41);
body.write("%PDF-1.4\n");
const put = await fetch(url, {
  method: "PUT",
  body: new Uint8Array(body),
});
console.log("PART", put.status, (await put.text()).slice(0, 500));
await signedFetch("DELETE", key, { uploadId }, {}, null);
