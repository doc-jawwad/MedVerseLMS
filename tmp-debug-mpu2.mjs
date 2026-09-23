#!/usr/bin/env node
import { createHmac, createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

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

const create = await signedFetch(
  "POST",
  key,
  { uploads: "" },
  { "content-type": "application/pdf" },
  null
);
const xml = await create.text();
const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
console.log("uploadIdLen", uploadId?.length);

const { amzDate: date, dateStamp } = amzDate();
const host = new URL(config.endpoint).host;
const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;

// Variant A: host only
// Variant B: include X-Amz-Content-Sha256=UNSIGNED-PAYLOAD in query
const variants = [
  {
    name: "host-only",
    signedHeaders: "host",
    headersBlock: `host:${host}\n`,
    extraQuery: [],
  },
  {
    name: "with-content-sha-query",
    signedHeaders: "host",
    headersBlock: `host:${host}\n`,
    extraQuery: [["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"]],
  },
];

for (const v of variants) {
  const q = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", "900"],
    ["X-Amz-SignedHeaders", v.signedHeaders],
    ["partNumber", "1"],
    ["uploadId", uploadId],
    ...v.extraQuery,
  ];
  const cq = canonicalQuery(q);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const cr = [
    "PUT",
    uri,
    cq,
    v.headersBlock,
    v.signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const crHash = sha256Hex(cr);
  const sts = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    crHash,
  ].join("\n");
  const sig = hmac(
    signingKey(config.secretAccessKey, dateStamp, config.region),
    sts
  ).toString("hex");
  const url = `${config.endpoint}${uri}?${cq}&X-Amz-Signature=${sig}`;
  const body = Buffer.alloc(8 * 1024 * 1024, 0x41);
  body.write("%PDF-1.4\n");
  const put = await fetch(url, {
    method: "PUT",
    body: new Uint8Array(body),
  });
  const text = await put.text();
  console.log(
    JSON.stringify({
      variant: v.name,
      status: put.status,
      crHash,
      uri,
      cqSample: cq.slice(0, 120),
      err: text.slice(0, 200),
    })
  );
}

await signedFetch("DELETE", key, { uploadId }, {}, null);
