#!/usr/bin/env node
/**
 * Staging Playwright runner — forces E2E_TARGET=staging so `.env.local`
 * (often production) is never loaded by the E2E harness.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.E2E_TARGET = "staging";
delete process.env.PLAYWRIGHT_BASE_URL;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const playwrightCli = path.join(
  root,
  "node_modules",
  "playwright",
  "cli.js"
);

const args = process.argv.slice(2);
const child = spawn(process.execPath, [playwrightCli, "test", ...args], {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
