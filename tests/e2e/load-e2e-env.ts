import fs from "fs";
import path from "path";

/** Production Cloud Supabase project — never an E2E target. */
export const PRODUCTION_SUPABASE_REF = "pxoxijlhcvbrostrquft";
/** Production LMS host — never an E2E target. */
export const PRODUCTION_APP_HOST = "lms.medversepk.com";
/** Staging Auth Cloud project (password/admin API). */
export const STAGING_AUTH_REF = "vygtwrsshcyfahfzurgq";
/** Staging app origin. */
export const STAGING_APP_ORIGIN = "https://staging.medversepk.com";

export type E2EEnv = {
  target: "staging" | "local";
  baseURL: string;
  /** Browser / Next public URL (usually same as app origin on staging). */
  supabaseUrl: string;
  /** Auth API base (Cloud staging Auth on staging runs). */
  authUrl: string;
  /** PostgREST base (staging app origin or local Kong). */
  restUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  adminEmail: string;
  adminPassword: string;
  stagingStudentEmail?: string;
  stagingStudentPassword?: string;
  /** SSH Host alias for privileged staging SQL (enrollments / attempt expiry). */
  stagingSsh?: string;
};

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function containsProductionMarker(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return (
    v.includes(PRODUCTION_SUPABASE_REF) ||
    v.includes(PRODUCTION_APP_HOST) ||
    // production apex without staging subdomain
    (/(^|https?:\/\/)(www\.)?medversepk\.com(\/|$)/i.test(value) &&
      !/staging\.medversepk\.com/i.test(value))
  );
}

/** Fail immediately if any configured URL points at production. */
export function assertNotProductionE2E(urls: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(urls)) {
    if (containsProductionMarker(value)) {
      throw new Error(
        `E2E safety abort: ${name} resolves to production (${value}). ` +
          `Refusing to run. Use staging.medversepk.com / ${STAGING_AUTH_REF} only.`
      );
    }
  }
}

function requireKeys(env: Record<string, string>, keys: string[], label: string) {
  const missing = keys.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `E2E safety abort (${label}): missing required keys: ${missing.join(", ")}`
    );
  }
}

/**
 * Load E2E env.
 * - E2E_TARGET=staging → `.env.e2e.staging` (or E2E_ENV_FILE); never `.env.local`
 * - otherwise → `.env.local` for local/dev Playwright (still refuses production URLs)
 */
export function loadE2EEnv(): E2EEnv {
  const targetRaw = (process.env.E2E_TARGET || "").trim().toLowerCase();
  const target: "staging" | "local" =
    targetRaw === "staging" ? "staging" : "local";

  const root = process.cwd();
  let fileEnv: Record<string, string> = {};

  if (target === "staging") {
    const stagingFile =
      process.env.E2E_ENV_FILE || path.join(root, ".env.e2e.staging");
    if (!fs.existsSync(stagingFile)) {
      throw new Error(
        `E2E safety abort: E2E_TARGET=staging but env file missing at ${stagingFile}. ` +
          `Copy tests/e2e/env.e2e.staging.example → .env.e2e.staging and fill staging secrets.`
      );
    }
    fileEnv = parseEnvFile(stagingFile);
    // Never merge .env.local in staging mode (it may point at production).
  } else {
    fileEnv = parseEnvFile(path.join(root, ".env.local"));
  }

  const merged: Record<string, string> = { ...fileEnv };
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && v !== "") merged[k] = v;
  }

  if (target === "staging") {
    requireKeys(
      merged,
      [
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "E2E_ADMIN_EMAIL",
        "E2E_ADMIN_PASSWORD",
      ],
      "staging"
    );
  }

  const baseURL =
    merged.PLAYWRIGHT_BASE_URL ||
    (target === "staging" ? STAGING_APP_ORIGIN : "http://localhost:3000");

  const supabaseUrl =
    merged.NEXT_PUBLIC_SUPABASE_URL ||
    (target === "staging" ? STAGING_APP_ORIGIN : "");

  const authUrl =
    merged.E2E_AUTH_URL ||
    (target === "staging"
      ? `https://${STAGING_AUTH_REF}.supabase.co`
      : supabaseUrl);

  const restUrl =
    merged.E2E_REST_URL ||
    (target === "staging" ? STAGING_APP_ORIGIN : supabaseUrl);

  const cfg: E2EEnv = {
    target,
    baseURL,
    supabaseUrl,
    authUrl,
    restUrl,
    anonKey: merged.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    serviceRoleKey: merged.SUPABASE_SERVICE_ROLE_KEY || "",
    adminEmail:
      merged.E2E_ADMIN_EMAIL ||
      merged.ADMIN_EMAIL ||
      "admin@medverse.local",
    adminPassword:
      merged.E2E_ADMIN_PASSWORD ||
      merged.ADMIN_PASSWORD ||
      "AdminPass123!",
    stagingStudentEmail: merged.E2E_STAGING_STUDENT_EMAIL,
    stagingStudentPassword: merged.E2E_STAGING_STUDENT_PASSWORD,
    stagingSsh: merged.E2E_STAGING_SSH,
  };

  assertNotProductionE2E({
    PLAYWRIGHT_BASE_URL: cfg.baseURL,
    NEXT_PUBLIC_SUPABASE_URL: cfg.supabaseUrl,
    E2E_AUTH_URL: cfg.authUrl,
    E2E_REST_URL: cfg.restUrl,
  });

  if (target === "staging") {
    assertStagingTarget(cfg);
    // Expose SSH host for fixtures that read process.env (and child tooling).
    if (cfg.stagingSsh && !process.env.E2E_STAGING_SSH) {
      process.env.E2E_STAGING_SSH = cfg.stagingSsh;
    }
  }

  return cfg;
}

export function assertStagingTarget(cfg: E2EEnv) {
  if (!cfg.baseURL.startsWith(STAGING_APP_ORIGIN)) {
    throw new Error(
      `E2E safety abort: staging baseURL must be ${STAGING_APP_ORIGIN}, got ${cfg.baseURL}`
    );
  }
  if (!cfg.restUrl.startsWith(STAGING_APP_ORIGIN)) {
    throw new Error(
      `E2E safety abort: staging REST URL must be ${STAGING_APP_ORIGIN}, got ${cfg.restUrl}`
    );
  }
  if (!cfg.authUrl.includes(STAGING_AUTH_REF) && !cfg.authUrl.startsWith(STAGING_APP_ORIGIN)) {
    throw new Error(
      `E2E safety abort: staging Auth URL must be Cloud ${STAGING_AUTH_REF} or ${STAGING_APP_ORIGIN}, got ${cfg.authUrl}`
    );
  }
  if (!cfg.anonKey || !cfg.serviceRoleKey) {
    throw new Error("E2E safety abort: staging anon/service keys missing");
  }
  if (!cfg.adminEmail || !cfg.adminPassword) {
    throw new Error("E2E safety abort: staging admin credentials missing");
  }
}

export function isJwtSecret(key: string): boolean {
  return key.split(".").length === 3;
}
