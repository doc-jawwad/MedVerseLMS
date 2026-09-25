import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPasswordRecoveryOtpType,
  passwordRecoveryNextPath,
  passwordRecoveryRedirectTo,
  PASSWORD_RECOVERY_PATH,
} from "../../src/lib/auth/password-recovery.ts";

describe("password recovery routing", () => {
  it("identifies recovery OTP type only", () => {
    assert.equal(isPasswordRecoveryOtpType("recovery"), true);
    assert.equal(isPasswordRecoveryOtpType("signup"), false);
    assert.equal(isPasswordRecoveryOtpType("email"), false);
    assert.equal(isPasswordRecoveryOtpType(null), false);
  });

  it("defaults next to /reset-password and rejects open redirects", () => {
    assert.equal(passwordRecoveryNextPath(null), PASSWORD_RECOVERY_PATH);
    assert.equal(passwordRecoveryNextPath(""), PASSWORD_RECOVERY_PATH);
    assert.equal(passwordRecoveryNextPath("/reset-password"), "/reset-password");
    assert.equal(
      passwordRecoveryNextPath("/reset-password?x=1"),
      "/reset-password?x=1"
    );
    assert.equal(
      passwordRecoveryNextPath("https://evil.example"),
      PASSWORD_RECOVERY_PATH
    );
    assert.equal(passwordRecoveryNextPath("//evil"), PASSWORD_RECOVERY_PATH);
  });

  it("builds redirectTo for default Auth ConfirmationURL", () => {
    assert.equal(
      passwordRecoveryRedirectTo("https://lms.medversepk.com"),
      "https://lms.medversepk.com/reset-password"
    );
    assert.equal(
      passwordRecoveryRedirectTo("https://staging.medversepk.com/"),
      "https://staging.medversepk.com/reset-password"
    );
  });
});

describe("auth confirm recovery must not depend on ensure_profile", () => {
  it("confirm route skips ensure_profile for recovery", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../src/app/auth/confirm/route.ts", import.meta.url),
        "utf8"
      )
    );
    assert.match(src, /isPasswordRecoveryOtpType/);
    assert.match(src, /passwordRecoveryNextPath/);
    const start = src.indexOf("if (isPasswordRecoveryOtpType(type))");
    const end = src.indexOf('rpc("ensure_profile")');
    assert.ok(start > 0 && end > start);
    const recoveryIf = src.slice(start, end);
    assert.match(recoveryIf, /return NextResponse\.redirect/);
    assert.equal(recoveryIf.includes('rpc("ensure_profile")'), false);
  });

  it("requestPasswordReset passes redirectTo when origin is configured", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../src/lib/actions/auth.ts", import.meta.url),
        "utf8"
      )
    );
    assert.match(src, /passwordRecoveryRedirectTo/);
    assert.match(src, /resetPasswordForEmail\(/);
    assert.match(src, /redirectTo/);
  });
});
