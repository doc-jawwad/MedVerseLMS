import { defineConfig, devices } from "@playwright/test";

// Runs against the already-running dev server (see .claude/launch.json /
// `npm run dev`) and the cloud Supabase project configured in .env.local.
// docs/exam-state-machine.md failure-scenario table is the checklist these
// specs work through.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // exam-engine specs share seeded fixture data
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
