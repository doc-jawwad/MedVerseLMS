import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("R2 / upload-session server-only boundaries", () => {
  it("marks credentialed R2 and upload-session modules as server-only", () => {
    for (const rel of [
      "src/lib/r2/presign.ts",
      "src/lib/r2/multipart.ts",
      "src/lib/r2/purge-worker-delete.ts",
      "src/lib/study/upload-session.ts",
    ]) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      assert.match(src, /import ["']server-only["']/, rel);
    }
  });

  it("does not import R2 credential modules from client components", () => {
    const clients = [];
    function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) clients.push(p);
      }
    }
    walk(path.join(root, "src/components"));
    walk(path.join(root, "src/app"));
    const offenders = [];
    for (const file of clients) {
      const raw = fs.readFileSync(file, "utf8");
      if (!/"use client"/.test(raw)) continue;
      if (
        /from ["']@\/lib\/r2\//.test(raw) ||
        /from ["']@\/lib\/study\/upload-session["']/.test(raw)
      ) {
        offenders.push(path.relative(root, file));
      }
    }
    assert.deepEqual(offenders, []);
  });
});
