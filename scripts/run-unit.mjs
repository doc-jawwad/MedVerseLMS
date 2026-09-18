#!/usr/bin/env node
import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = globSync("tests/unit/**/*.test.ts", { cwd: root }).map((f) =>
  path.join(root, f)
);

if (files.length === 0) {
  console.error("no unit tests found under tests/unit");
  process.exit(1);
}

const r = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { stdio: "inherit", cwd: root }
);
process.exit(r.status ?? 1);
