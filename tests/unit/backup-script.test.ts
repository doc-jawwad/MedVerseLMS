import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { looksLikeCloudSupabase } from "../../scripts/lib/env-guard.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(root, "deploy", "scripts", "backup-to-r2.sh");

const bash = process.platform === "win32" ? "bash" : "bash";

function runBackup(extra, args = []) {
  const assignments = Object.entries(extra)
    .map(([k, v]) => `${k}='${String(v).replace(/'/g, `'\\''`)}'`)
    .join(" ");
  const cmdline = `${assignments} ./deploy/scripts/backup-to-r2.sh ${args.join(" ")}`;
  return spawnSync(bash, ["-c", cmdline], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

describe("backup script source safety", () => {
  const src = fs.readFileSync(script, "utf8");

  it("never echoes password or key variables", () => {
    assert.equal(/echo .*PGPASSWORD/.test(src), false);
    assert.equal(/echo .*DUMP_ENCRYPTION_KEY/.test(src), false);
    assert.equal(/echo .*R2_SECRET/.test(src), false);
    assert.equal(/echo .*AWS_SECRET/.test(src), false);
    assert.match(src, /set -euo pipefail/);
    assert.match(src, /umask 077/);
  });

  it("refuses Cloud hosts in source", () => {
    assert.match(src, /supabase\.co/);
    assert.match(src, /I_UNDERSTAND_PRODUCTION/);
    assert.match(src, /BACKUP_KEEP_COUNT/);
  });
});

describe("looksLikeCloudSupabase", () => {
  it("flags hosted refs and pooler hosts", () => {
    assert.equal(looksLikeCloudSupabase("https://pxoxijlhcvbrostrquft.supabase.co"), true);
    assert.equal(looksLikeCloudSupabase("aws-0-ap-southeast-1.pooler.supabase.com"), true);
    assert.equal(looksLikeCloudSupabase("127.0.0.1"), false);
  });
});

describe("backup-to-r2.sh behaviour", () => {
  it("prints help without contacting R2", () => {
    const r = runBackup({}, ["--help"]);
    if (r.error && r.error.code === "ENOENT") {
      console.log("skip: bash not on PATH");
      return;
    }
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--dry-run/);
    assert.equal(r.stdout.includes("AKIA"), false);
  });

  it("dry-run refuses Cloud PGHOST without dumping", () => {
    const r = runBackup(
      {
        MEDVERSE_ENV: "vps-staging",
        PGHOST: "db.pxoxijlhcvbrostrquft.supabase.co",
        PGDATABASE: "postgres",
        PGUSER: "postgres",
        DUMP_ENCRYPTION_KEY: "x",
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "bucket",
      },
      ["--dry-run"]
    );
    if (r.error && r.error.code === "ENOENT") {
      console.log("skip: bash not on PATH");
      return;
    }
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Cloud/);
    assert.equal(r.stdout.includes("upload verified"), false);
  });

  it("dry-run on loopback does not upload", () => {
    const r = runBackup(
      {
        MEDVERSE_ENV: "vps-staging",
        PGHOST: "127.0.0.1",
        PGDATABASE: "medverse",
        PGUSER: "postgres",
        DUMP_ENCRYPTION_KEY: "x",
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "bucket",
        BACKUP_KEEP_COUNT: "14",
      },
      ["--dry-run", "--tag", "pre-exam"]
    );
    if (r.error && r.error.code === "ENOENT") {
      console.log("skip: bash not on PATH");
      return;
    }
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /dry-run: no dump, no upload/);
    assert.match(r.stdout, /pre-exam/);
  });

  it("refuses production without the confirm phrase", () => {
    const r = runBackup(
      {
        MEDVERSE_ENV: "production",
        PGHOST: "127.0.0.1",
        PGDATABASE: "medverse",
        PGUSER: "postgres",
        DUMP_ENCRYPTION_KEY: "x",
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "bucket",
      },
      ["--dry-run"]
    );
    if (r.error && r.error.code === "ENOENT") {
      console.log("skip: bash not on PATH");
      return;
    }
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /I_UNDERSTAND_PRODUCTION/);
  });

  it("rejects keep counts outside 7–14", () => {
    const r = runBackup(
      {
        MEDVERSE_ENV: "local",
        PGHOST: "127.0.0.1",
        PGDATABASE: "medverse",
        PGUSER: "postgres",
        DUMP_ENCRYPTION_KEY: "x",
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "bucket",
        BACKUP_KEEP_COUNT: "3",
      },
      ["--dry-run"]
    );
    if (r.error && r.error.code === "ENOENT") {
      console.log("skip: bash not on PATH");
      return;
    }
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /7 to 14/);
  });
});
