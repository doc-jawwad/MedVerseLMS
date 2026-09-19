import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectInstallPlatform,
  isExamLikePath,
  isStandaloneDisplay,
  resolveInstallSurface,
  shouldShowDashboardInstallCard,
} from "../../src/lib/pwa/install.ts";

describe("PWA install surface", () => {
  it("treats Android Chrome UA as android", () => {
    assert.equal(
      detectInstallPlatform(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36"
      ),
      "android"
    );
  });

  it("treats iPhone UA as ios", () => {
    assert.equal(
      detectInstallPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      ),
      "ios"
    );
  });

  it("treats iPadOS-as-Macintosh with touch as ios", () => {
    assert.equal(
      detectInstallPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        5
      ),
      "ios"
    );
  });

  it("hides install chrome on the exam player route", () => {
    assert.equal(
      resolveInstallSurface({
        pathname: "/tests/abc/attempt",
        standalone: false,
        platform: "android",
        canPrompt: true,
      }),
      "hidden"
    );
    assert.equal(
      resolveInstallSurface({
        pathname: "/dashboard",
        standalone: false,
        platform: "android",
        canPrompt: true,
        examActive: true,
      }),
      "hidden"
    );
    assert.equal(isExamLikePath("/admin/tests/xyz/preview"), true);
  });

  it("shows installed when standalone even on android", () => {
    assert.equal(
      resolveInstallSurface({
        pathname: "/dashboard",
        standalone: true,
        platform: "android",
        canPrompt: true,
      }),
      "installed"
    );
    assert.equal(
      shouldShowDashboardInstallCard("installed"),
      false
    );
  });

  it("uses the native prompt path when the browser exposes it", () => {
    assert.equal(
      resolveInstallSurface({
        pathname: "/dashboard",
        standalone: false,
        platform: "android",
        canPrompt: true,
      }),
      "android-install"
    );
  });

  it("uses the iOS guide when not installed", () => {
    assert.equal(
      resolveInstallSurface({
        pathname: "/profile",
        standalone: false,
        platform: "ios",
        canPrompt: false,
      }),
      "ios-guide"
    );
  });

  it("falls back when there is no prompt API", () => {
    assert.equal(
      resolveInstallSurface({
        pathname: "/dashboard",
        standalone: false,
        platform: "desktop",
        canPrompt: false,
      }),
      "fallback"
    );
  });

  it("detects standalone from iOS navigator.standalone", () => {
    assert.equal(
      isStandaloneDisplay({
        displayModeStandalone: false,
        iosStandalone: true,
      }),
      true
    );
  });
});
