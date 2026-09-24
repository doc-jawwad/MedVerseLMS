import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors createAdminAccount Auth-exists detection (keep in sync). */
function authEmailAlreadyRegistered(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";
  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    /already\s+(been\s+)?registered|already\s+exists|duplicate|email.*taken/i.test(
      msg
    )
  );
}

describe("admin create → reuse existing Auth identity", () => {
  it("detects email_exists code", () => {
    assert.equal(
      authEmailAlreadyRegistered({ code: "email_exists", message: "x" }),
      true
    );
  });
  it("detects already registered message", () => {
    assert.equal(
      authEmailAlreadyRegistered({
        message: "A user with this email address has already been registered",
      }),
      true
    );
  });
  it("ignores unrelated errors", () => {
    assert.equal(
      authEmailAlreadyRegistered({ message: "Database error creating new user" }),
      false
    );
  });
});
