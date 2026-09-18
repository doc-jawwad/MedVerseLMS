import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Caddyfile", () => {
  const caddy = read("deploy/Caddyfile");

  it("routes auth, rest, and Next.js as documented", () => {
    assert.match(caddy, /handle \/auth\/v1\*/);
    assert.match(caddy, /handle \/rest\/v1\*/);
    assert.match(caddy, /uri strip_prefix \/rest\/v1/);
    assert.match(caddy, /SUPABASE_AUTH_HOST/);
    assert.match(caddy, /NEXT_UPSTREAM:127\.0\.0\.1:3000/);
    assert.match(caddy, /POSTGREST_UPSTREAM:127\.0\.0\.1:3001/);
  });

  it("does not hardcode secrets or a live project ref", () => {
    assert.equal(/eyJ[A-Za-z0-9_-]{20,}/.test(caddy), false);
    assert.equal(caddy.includes("pxoxijlhcvbrostrquft"), false);
    assert.equal(caddy.includes("sk-"), false);
    assert.match(caddy, /admin 127\.0\.0\.1:2019/);
  });
});

describe("staging Caddy site", () => {
  it("uses a one-level wildcard hostname and staging Auth/upstreams", () => {
    const site = read("deploy/Caddyfile.staging.site");
    assert.match(site, /https:\/\/staging\.medversepk\.com/);
    assert.match(site, /vygtwrsshcyfahfzurgq\.supabase\.co/);
    assert.match(site, /127\.0\.0\.1:3010/);
    assert.match(site, /127\.0\.0\.1:3011/);
    assert.equal(site.includes("pxoxijlhcvbrostrquft"), false);
    assert.equal(/https:\/\/lms\.medversepk\.com/.test(site), false);
  });
});

describe("systemd units", () => {
  it("keeps Next and PostgREST independently restartable", () => {
    const next = read("deploy/systemd/medverse-next.service");
    const rest = read("deploy/systemd/medverse-postgrest.service");
    assert.match(next, /Restart=on-failure/);
    assert.match(rest, /Restart=on-failure/);
    assert.equal(next.includes("BindsTo=medverse-postgrest"), false);
    assert.equal(rest.includes("BindsTo=medverse-next"), false);
    assert.match(next, /EnvironmentFile=\/etc\/medverse\/nextjs\.env/);
    assert.match(rest, /EnvironmentFile=\/etc\/medverse\/postgrest\.env/);
  });

  it("keeps staging units on isolated ports and env dir", () => {
    const next = read("deploy/systemd/medverse-staging-next.service");
    const rest = read("deploy/systemd/medverse-staging-postgrest.service");
    assert.match(next, /PORT=3010/);
    assert.match(next, /EnvironmentFile=\/etc\/medverse-staging\/nextjs\.env/);
    assert.match(next, /WorkingDirectory=\/opt\/medverse-staging\/current/);
    assert.match(rest, /EnvironmentFile=\/etc\/medverse-staging\/postgrest\.env/);
    assert.match(rest, /\/etc\/medverse-staging\/postgrest\.conf/);
    assert.equal(next.includes("PORT=3000"), false);
    assert.equal(rest.includes("3001"), false);
  });

  it("does not put JWT or passwords in unit files", () => {
    const dir = path.join(root, "deploy", "systemd");
    for (const name of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      assert.equal(/eyJ[A-Za-z0-9_-]{20,}/.test(text), false, name);
      assert.equal(/PASSWORD=/.test(text), false, name);
    }
  });

  it("documents PostgreSQL as the distro unit, not a custom service", () => {
    assert.equal(fs.existsSync(path.join(root, "deploy/systemd/postgresql.service")), false);
    assert.match(read("deploy/systemd/README-postgresql.txt"), /distro postgresql\.service/);
  });
});

describe("env examples", () => {
  it("use placeholders rather than live credentials", () => {
    const files = [
      "deploy/env/nextjs.env.example",
      "deploy/env/postgrest.env.example",
      "deploy/env/backup.env.example",
      "deploy/env/nextjs.staging.env.example",
      "deploy/env/postgrest.staging.env.example",
    ];
    for (const rel of files) {
      const text = read(rel);
      assert.match(text, /REPLACE_/);
      assert.equal(/eyJhbGciOi/.test(text), false, rel);
    }
  });
});

describe("vercel.json preserved", () => {
  it("still declares the Hobby-shaped cron", () => {
    const v = JSON.parse(read("vercel.json"));
    assert.equal(v.crons[0].path, "/api/cron/auto-submit");
    assert.equal(v.crons[0].schedule, "0 0 * * *");
  });
});

describe("supabase clients do not use sb_* as PostgREST Bearer", () => {
  it("wires the PostgREST fetch wrapper into browser, server, admin, and proxy", () => {
    for (const rel of [
      "src/lib/supabase/client.ts",
      "src/lib/supabase/server.ts",
      "src/lib/supabase/admin.ts",
      "src/proxy.ts",
    ]) {
      assert.match(read(rel), /supabaseFetch/);
    }
  });

  it("register loadYears keeps the internal PostgREST path without Authorization", () => {
    const src = read("src/app/(public)/register/page.tsx");
    assert.match(src, /POSTGREST_INTERNAL_URL/);
    assert.equal(src.includes("Authorization"), false);
  });

  it("HTTP auto-submit refuses opaque service keys", () => {
    const src = read("src/app/api/cron/auto-submit/route.ts");
    assert.match(src, /isJwt/);
    assert.match(src, /service_role_jwt_required/);
  });

  it("systemd auto-submit backup prefers local SQL over PostgREST", () => {
    const src = read("deploy/scripts/auto-submit-once.sh");
    assert.match(src, /auto_submit_expired/);
    assert.match(src, /sudo -n -u postgres psql/);
    assert.match(src, /\/api\/cron\/auto-submit/);
  });
});
