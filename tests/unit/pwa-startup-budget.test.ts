import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PUBLIC_AUTH_REFRESH_BUDGET_MS,
  PWA_START_SESSION_BUDGET_MS,
  isPublicStartupPath,
  raceWithTimeout,
} from "../../src/lib/pwa/startup-budget.ts";

describe("PWA startup budgets", () => {
  it("keeps public Auth refresh and session budgets bounded", () => {
    assert.ok(PUBLIC_AUTH_REFRESH_BUDGET_MS <= 500);
    assert.ok(PWA_START_SESSION_BUDGET_MS <= 2500);
    assert.ok(PUBLIC_AUTH_REFRESH_BUDGET_MS > 0);
    assert.ok(PWA_START_SESSION_BUDGET_MS > PUBLIC_AUTH_REFRESH_BUDGET_MS);
  });

  it("treats start_url and auth shells as public startup paths", () => {
    assert.equal(isPublicStartupPath("/"), true);
    assert.equal(isPublicStartupPath("/login"), true);
    assert.equal(isPublicStartupPath("/dashboard"), false);
    assert.equal(isPublicStartupPath("/admin"), false);
  });

  it("raceWithTimeout resolves value before the budget", async () => {
    const result = await raceWithTimeout(
      Promise.resolve("ok"),
      200
    );
    assert.deepEqual(result, { timedOut: false, value: "ok" });
  });

  it("raceWithTimeout times out slow work", async () => {
    const result = await raceWithTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("late"), 80);
      }),
      20
    );
    assert.deepEqual(result, { timedOut: true });
  });
});

describe("PWA start_url does not block first paint on server auth", () => {
  it("home renders client bootstrap splash instead of awaiting redirectIfAuthenticated", () => {
    const home = readFileSync(
      path.join(process.cwd(), "src/app/page.tsx"),
      "utf8"
    );
    const start = readFileSync(
      path.join(process.cwd(), "src/components/pwa/pwa-start-screen.tsx"),
      "utf8"
    );
    const splash = readFileSync(
      path.join(process.cwd(), "src/components/pwa/pwa-boot-splash.tsx"),
      "utf8"
    );
    const proxy = readFileSync(
      path.join(process.cwd(), "src/proxy.ts"),
      "utf8"
    );

    assert.match(home, /PwaStartScreen/);
    assert.doesNotMatch(home, /redirectIfAuthenticated/);
    assert.match(start, /PwaBootSplash/);
    assert.match(start, /getSession/);
    assert.match(start, /PWA_START_SESSION_BUDGET_MS/);
    assert.match(start, /router\.replace\("\/dashboard"\)/);
    assert.match(splash, /MedDesk\.pk/);
    assert.match(splash, /logo-icon-on-dark\.png/);
    assert.match(splash, /#072855/);
    assert.match(proxy, /PUBLIC_AUTH_REFRESH_BUDGET_MS/);
    assert.match(proxy, /raceWithTimeout/);
    assert.match(proxy, /isPublicStartupPath/);
  });

  it("login/register still server-redirect authenticated users", () => {
    const login = readFileSync(
      path.join(process.cwd(), "src/app/(public)/login/page.tsx"),
      "utf8"
    );
    const register = readFileSync(
      path.join(process.cwd(), "src/app/(public)/register/page.tsx"),
      "utf8"
    );
    assert.match(login, /redirectIfAuthenticated/);
    assert.match(register, /redirectIfAuthenticated/);
  });
});
