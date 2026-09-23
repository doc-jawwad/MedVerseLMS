#!/usr/bin/env node
/**
 * Staging/local smoke: multipart + PUT against R2 using host env.
 * Does NOT touch Postgres. Deletes the object afterward.
 *
 * Usage (on VPS as medverse with nextjs.env sourced):
 *   node scripts/r2-multipart-smoke.mjs [bytes]
 */
import { createHmac, createHash, randomUUID } from "node:crypto";

function reqEnv(name) {
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
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"), "aws4_request");
}

function getConfig() {
  const accountId = reqEnv("R2_ACCOUNT_ID");
  const accessKeyId = reqEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = reqEnv("R2_SECRET_ACCESS_KEY");
  const bucket =
    process.env.R2_PAYMENT_BUCKET?.trim() ||
    process.env.R2_BUCKET?.trim() ||
    "";
  if (!bucket) throw new Error("missing_bucket");
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

function canonicalQuery(pairs) {
  return [...pairs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function presignPut(config, key, query, contentType, expires = 900) {
  const { amzDate: date, dateStamp } = amzDate();
  const host = new URL(config.endpoint).host;
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const signedHeaderNames = contentType ? "content-type;host" : "host";
  const q = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", date],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", signedHeaderNames],
    ...Object.entries(query ?? {}),
  ];
  const cq = canonicalQuery(q);
  const uri = `/${encodePath(`${config.bucket}/${key}`)}`;
  const ch = contentType
    ? `content-type:${contentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const cr = ["PUT", uri, cq, ch, signedHeaderNames, "UNSIGNED-PAYLOAD"].join("\n");
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

async function signedFetch(config, method, key, query, headers, body) {
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
  const bodyInit =
    body == null
      ? undefined
      : typeof body === "string"
        ? body
        : new Uint8Array(body);
  return fetch(url, {
    method,
    headers: {
      ...Object.fromEntries(Object.entries(headerMap).filter(([k]) => k !== "host")),
      Authorization: auth,
    },
    body: bodyInit,
  });
}

function makePdf(bytes) {
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\nsynthetic\n");
  const out = Buffer.alloc(bytes);
  header.copy(out);
  out.write("%%EOF\n", bytes - 6);
  return out;
}

async function main() {
  const bytes = Number(process.argv[2] ?? String(40 * 1024 * 1024));
  const config = getConfig();
  const key = `study-content/smoke/${randomUUID()}.pdf`;
  const contentType = "application/pdf";
  const started = Date.now();
  const mem0 = process.memoryUsage().heapUsed;

  console.log(JSON.stringify({ phase: "start", bytes, key, bucket: config.bucket }));

  if (bytes < 32 * 1024 * 1024) {
    const url = presignPut(config, key, {}, contentType);
    const body = makePdf(bytes);
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });
    if (!put.ok) throw new Error(`put_failed:${put.status}:${await put.text()}`);
  } else {
    const create = await signedFetch(
      config,
      "POST",
      key,
      { uploads: "" },
      { "content-type": contentType },
      null
    );
    if (!create.ok) throw new Error(`create_failed:${create.status}:${await create.text()}`);
    const xml = await create.text();
    const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
    if (!uploadId) throw new Error("no_upload_id");

    const partSize = 16 * 1024 * 1024;
    const partCount = Math.ceil(bytes / partSize);
    const parts = [];
    for (let n = 1; n <= partCount; n++) {
      const start = (n - 1) * partSize;
      const end = Math.min(start + partSize, bytes);
      const chunk = makePdf(end - start);
      // only first part needs real magic; others just bytes
      if (n > 1) chunk.fill(0x41, 0, 8);
      const url = presignPut(config, key, {
        partNumber: String(n),
        uploadId,
      });
      const put = await fetch(url, {
        method: "PUT",
        body: new Uint8Array(chunk),
      });
      if (!put.ok) {
        const detail = (await put.text()).slice(0, 300);
        throw new Error(`part_${n}_failed:${put.status}:${detail}`);
      }
      const etag = put.headers.get("etag");
      if (!etag) throw new Error(`part_${n}_no_etag`);
      parts.push({ partNumber: n, etag });
      console.log(JSON.stringify({ phase: "part", n, size: end - start }));
    }
    // fix: first part must be real PDF magic for whole object — rebuild object correctly
    // For smoke we complete with parts as uploaded; magic check uses first 8 bytes of object = first part.
    const body =
      `<CompleteMultipartUpload>` +
      parts
        .map(
          (p) =>
            `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/&/g, "&amp;")}</ETag></Part>`
        )
        .join("") +
      `</CompleteMultipartUpload>`;
    const done = await signedFetch(
      config,
      "POST",
      key,
      { uploadId },
      { "content-type": "application/xml" },
      body
    );
    if (!done.ok) throw new Error(`complete_failed:${done.status}:${await done.text()}`);
  }

  const head = await signedFetch(config, "HEAD", key, {}, {}, null);
  if (!head.ok) throw new Error(`head_failed:${head.status}`);
  const len = Number(head.headers.get("content-length"));
  const range = await signedFetch(
    config,
    "GET",
    key,
    {},
    { Range: "bytes=0-7" },
    null
  );
  const magicBuf = Buffer.from(await range.arrayBuffer());
  const magic = magicBuf.toString("utf8");
  const del = await signedFetch(config, "DELETE", key, {}, {}, null);

  const mem1 = process.memoryUsage().heapUsed;
  console.log(
    JSON.stringify({
      phase: "done",
      contentLength: len,
      magic,
      magicOk: magic.startsWith("%PDF-"),
      deleteStatus: del.status,
      elapsedMs: Date.now() - started,
      heapDeltaMb: Number(((mem1 - mem0) / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((mem1 / (1024 * 1024)).toFixed(2)),
    })
  );
  if (!magic.startsWith("%PDF-")) process.exit(2);
  if (len !== bytes) {
    console.error(JSON.stringify({ error: "size_mismatch", len, bytes }));
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message || e) }));
  process.exit(1);
});
