import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySignUpResult,
  formatSignUpAuthErrorForLog,
  isExplicitUserAlreadyRegistered,
  sanitizeAuthErrorMessageForLog,
} from "../../src/lib/auth/signup-result.ts";

describe("sanitizeAuthErrorMessageForLog", () => {
  it("redacts email addresses", () => {
    assert.equal(
      sanitizeAuthErrorMessageForLog(
        "Unable to send to student@college.edu.pk — try again"
      ),
      "Unable to send to [email] — try again"
    );
  });

  it("redacts JWT-shaped tokens", () => {
    assert.equal(
      sanitizeAuthErrorMessageForLog(
        "bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature leftover"
      ),
      "bad token [token] leftover"
    );
  });
});

describe("formatSignUpAuthErrorForLog", () => {
  it("joins code, status, and message without fabricating fields", () => {
    assert.equal(
      formatSignUpAuthErrorForLog({
        code: "over_email_send_rate_limit",
        status: 429,
        message: "email rate limit exceeded",
      }),
      "code=over_email_send_rate_limit status=429 email rate limit exceeded"
    );
  });

  it("handles message-only Auth errors", () => {
    assert.equal(
      formatSignUpAuthErrorForLog({ message: "Signup requires a valid password" }),
      "Signup requires a valid password"
    );
  });

  it("redacts emails embedded in Auth messages", () => {
    assert.equal(
      formatSignUpAuthErrorForLog({
        code: "unexpected_failure",
        status: 500,
        message: "Could not deliver mail to alice@example.com",
      }),
      "code=unexpected_failure status=500 Could not deliver mail to [email]"
    );
  });

  it("handles null / empty Auth errors", () => {
    assert.equal(formatSignUpAuthErrorForLog(null), "(no error)");
    assert.equal(formatSignUpAuthErrorForLog({}), "(empty Auth error)");
  });
});

describe("isExplicitUserAlreadyRegistered", () => {
  it("matches code and message variants", () => {
    assert.equal(
      isExplicitUserAlreadyRegistered({ code: "user_already_exists" }),
      true
    );
    assert.equal(
      isExplicitUserAlreadyRegistered({
        message: "User already registered",
      }),
      true
    );
    assert.equal(
      isExplicitUserAlreadyRegistered({
        message: "USER ALREADY REGISTERED with this email",
      }),
      true
    );
    assert.equal(
      isExplicitUserAlreadyRegistered({ message: "Invalid email" }),
      false
    );
    assert.equal(isExplicitUserAlreadyRegistered(null), false);
  });
});

describe("classifySignUpResult", () => {
  it("new email → needs_verification", () => {
    const result = classifySignUpResult({
      user: { identities: [{ id: "ident-1" }] },
      session: null,
      error: null,
    });
    assert.deepEqual(result, { outcome: "needs_verification" });
  });

  it("existing verified (empty identities) → existing_verified", () => {
    const result = classifySignUpResult({
      user: { identities: [] },
      session: null,
      error: null,
    });
    assert.deepEqual(result, { outcome: "existing_verified" });
  });

  it("existing unverified (identities present) → needs_verification", () => {
    const result = classifySignUpResult({
      user: { identities: [{ provider: "email" }] },
      session: null,
      error: null,
    });
    assert.deepEqual(result, { outcome: "needs_verification" });
  });

  it("explicit user_already_exists → existing_verified", () => {
    const result = classifySignUpResult({
      user: null,
      session: null,
      error: { code: "user_already_exists", message: "User already registered" },
    });
    assert.deepEqual(result, { outcome: "existing_verified" });
  });

  it("generic signUp error → sanitized error path", () => {
    const result = classifySignUpResult({
      user: null,
      session: null,
      error: { message: "Signup requires a valid password" },
    });
    assert.deepEqual(result, {
      outcome: "error",
      message: "Could not create your account. Please try again.",
    });
  });

  it("session present → session (ensure_profile path)", () => {
    const result = classifySignUpResult({
      user: { identities: [{ id: "ident-1" }] },
      session: { access_token: "x" },
      error: null,
    });
    assert.deepEqual(result, { outcome: "session" });
  });

  it("user null / identities missing with no error → existing_verified", () => {
    assert.deepEqual(
      classifySignUpResult({ user: null, session: null, error: null }),
      { outcome: "existing_verified" }
    );
    assert.deepEqual(
      classifySignUpResult({
        user: { identities: null },
        session: null,
        error: null,
      }),
      { outcome: "existing_verified" }
    );
    assert.deepEqual(
      classifySignUpResult({
        user: {},
        session: null,
        error: null,
      }),
      { outcome: "existing_verified" }
    );
  });
});
