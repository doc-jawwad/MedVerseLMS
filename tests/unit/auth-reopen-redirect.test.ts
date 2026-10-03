import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("authenticated reopen UX", () => {
  it("home bootstraps session on the client; auth shells still server-redirect", () => {
    const home = readFileSync(
      path.join(process.cwd(), "src/app/page.tsx"),
      "utf8"
    );
    const start = readFileSync(
      path.join(process.cwd(), "src/components/pwa/pwa-start-screen.tsx"),
      "utf8"
    );
    const login = readFileSync(
      path.join(process.cwd(), "src/app/(public)/login/page.tsx"),
      "utf8"
    );
    const register = readFileSync(
      path.join(process.cwd(), "src/app/(public)/register/page.tsx"),
      "utf8"
    );
    const helper = readFileSync(
      path.join(process.cwd(), "src/lib/auth/redirect-if-authenticated.ts"),
      "utf8"
    );

    assert.match(helper, /getClaims/);
    assert.match(helper, /safeInternalPath/);
    assert.match(helper, /\/dashboard/);
    assert.match(helper, /\/admin/);
    // PWA start_url must paint before awaiting server auth/profile.
    assert.match(home, /PwaStartScreen/);
    assert.doesNotMatch(home, /redirectIfAuthenticated/);
    assert.match(start, /getSession/);
    assert.match(start, /\/dashboard/);
    assert.match(login, /redirectIfAuthenticated/);
    assert.match(register, /redirectIfAuthenticated/);
    // Kick / expired must still reach the login form.
    assert.match(login, /session_expired/);
    assert.match(login, /kicked/);
  });
});
