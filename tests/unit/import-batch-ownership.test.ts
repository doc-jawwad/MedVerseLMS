import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const importActionSrc = fs.readFileSync(
  path.join(root, "src/lib/actions/import.ts"),
  "utf8"
);

describe("createImportBatch ownership wiring", () => {
  it("sets import_batches.created_by from the authenticated admin (auth.getUser)", () => {
    const fn = importActionSrc.match(
      /export async function createImportBatch\([\s\S]*?\n\}/
    );
    assert.ok(fn, "expected createImportBatch function");
    const body = fn![0]!;
    assert.match(body, /auth\.getUser\(\)/);
    assert.match(body, /created_by:\s*user\.id/);
    assert.match(body, /\.insert\(\s*\{[\s\S]*created_by:\s*user\.id/);
  });

  it("does not accept a client-supplied created_by (no spoof path)", () => {
    const sig = importActionSrc.match(
      /export async function createImportBatch\(([^)]*)\)/
    );
    assert.ok(sig, "expected createImportBatch signature");
    const params = sig![1]!.replace(/\s+/g, " ").trim();
    assert.equal(params, "filename: string, totalRows: number");
    assert.equal(params.includes("created_by"), false);

    const fn = importActionSrc.match(
      /export async function createImportBatch\([\s\S]*?\n\}/
    )![0]!;
    const createdByAssigns = [...fn.matchAll(/created_by\s*:\s*([^,\n}]+)/g)].map(
      (m) => m[1]!.trim()
    );
    assert.deepEqual(createdByAssigns, ["user.id"]);
  });

  it("does not change importChunk / question ownership path", () => {
    const chunk = importActionSrc.match(
      /export async function importChunk\([\s\S]*?\n\}/
    );
    assert.ok(chunk, "expected importChunk");
    assert.match(chunk![0]!, /import_question_batch/);
    assert.equal(chunk![0]!.includes("created_by"), false);
  });

  it("CSV import clients still call createImportBatch(filename, rows.length)", () => {
    const bank = fs.readFileSync(
      path.join(root, "src/app/(admin)/admin/questions/import/import-client.tsx"),
      "utf8"
    );
    const builder = fs.readFileSync(
      path.join(
        root,
        "src/app/(admin)/admin/tests/test-builder-csv-import.tsx"
      ),
      "utf8"
    );
    assert.match(bank, /createImportBatch\(\s*filename\s*,\s*rows\.length\s*\)/);
    assert.match(builder, /createImportBatch\(/);
    assert.equal(bank.includes("created_by"), false);
    assert.equal(builder.includes("created_by"), false);
  });
});
