import { defineConfig, devices } from "@playwright/test";
import { loadE2EEnv } from "./tests/e2e/load-e2e-env";

// Local default: already-running `npm run dev` + `.env.local`.
// Staging: `E2E_TARGET=staging` + `.env.e2e.staging` → https://staging.medversepk.com
// Production URLs are refused by loadE2EEnv() before any test runs.
const e2e = loadE2EEnv();

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: /loadtest-e2e-smoke/,
  fullyParallel: false, // exam-engine specs share seeded fixture data
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: e2e.target === "staging" ? 120_000 : 60_000,
  use: {
    baseURL: e2e.baseURL,
    // Staging Windows runs occasionally lose mid-close trace zips (ENOENT);
    // keep traces for local debugging only.
    trace: e2e.target === "staging" ? "off" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
