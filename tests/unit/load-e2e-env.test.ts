import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadE2EEnv } from "../e2e/load-e2e-env.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const KEYS = [
  "E2E_TARGET",
  "E2E_ENV_FILE",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "PLAYWRIGHT_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_AUTH_URL",
  "E2E_REST_URL",
];

const prev: Record<string, string | undefined> = {};
for (const k of KEYS) prev[k] = process.env[k];

after(() => {
  for (const k of KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
});

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fn();
}

describe("loadE2EEnv fail-closed password", () => {
  it("has no hardcoded AdminPass123! fallback in source", () => {
    const src = fs.readFileSync(path.join(root, "tests/e2e/load-e2e-env.ts"), "utf8");
    assert.equal(src.includes("AdminPass123!"), false);
    assert.match(src, /missing E2E_ADMIN_PASSWORD/);
  });

  it("throws when E2E_ADMIN_PASSWORD is absent locally", () => {
    withEnv(
      {
        E2E_TARGET: "local",
        PLAYWRIGHT_BASE_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      },
      () => {
        assert.throws(() => loadE2EEnv(), /missing E2E_ADMIN_PASSWORD/);
      }
    );
  });

  it("accepts E2E_ADMIN_PASSWORD from the environment", () => {
    withEnv(
      {
        E2E_TARGET: "local",
        PLAYWRIGHT_BASE_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        E2E_ADMIN_PASSWORD: "local-e2e-password-not-a-fallback",
      },
      () => {
        const cfg = loadE2EEnv();
        assert.equal(cfg.target, "local");
        assert.equal(cfg.adminPassword, "local-e2e-password-not-a-fallback");
      }
    );
  });

  it("throws for staging when the password key is missing from the env file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medverse-e2e-"));
    const file = path.join(dir, "env");
    fs.writeFileSync(
      file,
      [
        "E2E_TARGET=staging",
        "PLAYWRIGHT_BASE_URL=https://staging.medversepk.com",
        "NEXT_PUBLIC_SUPABASE_URL=https://staging.medversepk.com",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_test_not_a_secret",
        "SUPABASE_SERVICE_ROLE_KEY=sb_secret_test_not_a_secret",
        "E2E_ADMIN_EMAIL=staging-admin@medverse.local",
        "",
      ].join("\n")
    );
    try {
      withEnv(
        {
          E2E_TARGET: "staging",
          E2E_ENV_FILE: file,
        },
        () => {
          assert.throws(() => loadE2EEnv(), /E2E_ADMIN_PASSWORD/);
        }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
