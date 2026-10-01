import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { avatarProxyUrl } from "../../src/lib/profile/avatar-url.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("signed URL exposure reduction (M10)", () => {
  it("payment-proof API authorizes then streams (no signed URL to client)", () => {
    const src = read("src/app/api/payment-proofs/[applicationId]/route.ts");
    assert.match(src, /authorize_payment_screenshot_access/);
    assert.match(src, /getR2Object/);
    assert.match(src, /private, no-store/);
    assert.equal(src.includes("presignR2Object"), false);
    assert.equal(src.includes("r2.cloudflarestorage.com"), false);
  });

  it("payment screenshot read action returns same-origin proxy path", () => {
    const src = read("src/lib/actions/subscription-applications.ts");
    assert.match(src, /authorize_payment_screenshot_access/);
    assert.match(src, /\/api\/payment-proofs\//);
    assert.equal(src.includes("presignR2Object"), false);
    assert.doesNotMatch(src, /expiresSeconds:\s*300/);
  });

  it("avatar API authorizes then streams (no signed URL to client)", () => {
    const src = read("src/app/api/avatars/[studentId]/route.ts");
    assert.match(src, /authorize_avatar_object/);
    assert.match(src, /getR2Object/);
    assert.match(src, /private, no-store/);
    assert.equal(src.includes("presignR2Object"), false);
  });

  it("profile and student-360 use avatar proxy URLs, not R2 presign for GET", () => {
    const profile = read("src/lib/profile/adapter.ts");
    const admin = read("src/lib/admin/student-360/adapter.ts");
    assert.match(profile, /avatarProxyUrl/);
    assert.match(admin, /avatarProxyUrl/);
    // GET signing for display must be gone (PUT allocate may still call presign).
    assert.doesNotMatch(
      profile,
      /presignR2Object\(\{\s*method:\s*"GET"/
    );
    assert.equal(admin.includes("presignR2Object"), false);
  });

  it("avatarProxyUrl builds same-origin paths with optional cache bust", () => {
    assert.equal(avatarProxyUrl("me"), "/api/avatars/me");
    assert.equal(
      avatarProxyUrl("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      "/api/avatars/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    );
    assert.equal(
      avatarProxyUrl("me", "study-content/avatars/u/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      "/api/avatars/me?v=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );
  });

  it("admin screenshot UI no longer claims a short-lived R2 link", () => {
    const src = read(
      "src/app/(admin)/admin/subscriptions/application-actions.tsx"
    );
    assert.match(src, /getPaymentScreenshotReadUrl/);
    assert.doesNotMatch(src, /Short-lived authorized link/);
  });
});
