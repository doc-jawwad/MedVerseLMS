#!/usr/bin/env node
// Runs the pgTAP suite in supabase/tests/ against the target database.
// Each file is executed as one big multi-statement query so its own
// BEGIN...ROLLBACK controls the transaction; nothing here ever commits
// fixture data. Requires PGTAP_DB_URL (or falls back to SUPABASE_DB_URL
// from .env.local) and the pgtap extension (installed on first run).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { assertNotCloudProduction } from "./lib/env-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const env = loadEnvLocal();
  const connectionString = process.env.PGTAP_DB_URL || env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Set PGTAP_DB_URL or SUPABASE_DB_URL in .env.local");
    process.exit(1);
  }

  try {
    assertNotCloudProduction(connectionString, { allowStaging: false });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  await client.query("create extension if not exists pgtap");

  const dir = path.join(__dirname, "..", "supabase", "tests");
  const helperFile = "000_helpers.sql";
  const helperSql = fs.readFileSync(path.join(dir, helperFile), "utf8");
  await client.query(helperSql);
  console.log(`Loaded ${helperFile}`);

  const testFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f !== helperFile)
    .sort();

  let totalFail = 0;
  for (const file of testFiles) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`\n=== ${file} ===`);
    try {
      const result = await client.query(sql);
      const resultArray = Array.isArray(result) ? result : [result];
      const rows = resultArray.flatMap((r) => r.rows || []);
      const lines = rows.map((r) => Object.values(r)[0]).filter((v) => typeof v === "string");
      for (const line of lines) console.log(line);
      const failed = lines.filter((l) => /^not ok/.test(l));
      totalFail += failed.length;
    } catch (err) {
      console.error(`ERROR running ${file}:`, err.message);
      totalFail += 1;
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
  }

  await client.end();
  console.log(`\n${totalFail === 0 ? "ALL TESTS PASSED" : `${totalFail} FAILURE(S)`}`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
