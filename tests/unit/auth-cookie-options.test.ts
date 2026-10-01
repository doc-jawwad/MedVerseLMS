import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { supabaseAuthCookieOptions } from "../../src/lib/supabase/auth-cookie-options.ts";

describe("supabaseAuthCookieOptions (M3/L1)", () => {
  it("sets path, SameSite, and explicit httpOnly=false for SSR browser storage", () => {
    const opts = supabaseAuthCookieOptions();
    assert.equal(opts.path, "/");
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.httpOnly, false);
    assert.equal(typeof opts.secure, "boolean");
  });

  it("wires cookieOptions into server, proxy, and browser clients", () => {
    const server = readFileSync(
      path.join(process.cwd(), "src/lib/supabase/server.ts"),
      "utf8"
    );
    const proxy = readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
    const client = readFileSync(
      path.join(process.cwd(), "src/lib/supabase/client.ts"),
      "utf8"
    );
    assert.match(server, /supabaseAuthCookieOptions/);
    assert.match(server, /cookieOptions:\s*supabaseAuthCookieOptions\(\)/);
    assert.match(proxy, /supabaseAuthCookieOptions/);
    assert.match(proxy, /cookieOptions:\s*supabaseAuthCookieOptions\(\)/);
    assert.match(client, /supabaseAuthCookieOptions/);
    assert.match(client, /cookieOptions:\s*supabaseAuthCookieOptions\(\)/);
  });
});
