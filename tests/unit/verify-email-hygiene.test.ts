import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("verify-email URL hygiene (F6)", () => {
  it("does not redirect with ?email= in auth actions", () => {
    const auth = readFileSync(
      path.join(root, "src/lib/actions/auth.ts"),
      "utf8"
    );
    assert.doesNotMatch(auth, /verify-email\?email=/);
    assert.match(auth, /setVerifyEmailCookie/);
    assert.match(auth, /redirect\("\/verify-email"\)/);
  });

  it("reads email from httpOnly cookie, not searchParams", () => {
    const page = readFileSync(
      path.join(root, "src/app/(public)/verify-email/page.tsx"),
      "utf8"
    );
    assert.match(page, /readVerifyEmailCookie/);
    assert.doesNotMatch(page, /searchParams/);
    assert.doesNotMatch(page, /\?email=/);
  });
});
