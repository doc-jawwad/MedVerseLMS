import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isSafeInternalPath,
  safeInternalPath,
} from "../../src/lib/http/safe-internal-path.ts";
import { getPublicOrigin } from "../../src/lib/http/public-origin.ts";

describe("safeInternalPath", () => {
  it("accepts same-origin relative paths", () => {
    assert.equal(isSafeInternalPath("/"), true);
    assert.equal(isSafeInternalPath("/dashboard"), true);
    assert.equal(isSafeInternalPath("/reset-password?x=1"), true);
    assert.equal(safeInternalPath("/admin"), "/admin");
  });

  it("rejects open redirects", () => {
    assert.equal(isSafeInternalPath("//evil.example"), false);
    assert.equal(isSafeInternalPath("https://evil.example"), false);
    assert.equal(isSafeInternalPath("/\\evil"), false);
    assert.equal(isSafeInternalPath("dashboard"), false);
    assert.equal(isSafeInternalPath("javascript:alert(1)"), false);
    assert.equal(isSafeInternalPath("data:text/html,x"), false);
    assert.equal(safeInternalPath("//evil.example", "/login"), "/login");
    assert.equal(safeInternalPath("https://x", "/"), "/");
    assert.equal(safeInternalPath("javascript:alert(1)", "/dashboard"), "/dashboard");
  });

  it("falls back for null/empty/malformed", () => {
    assert.equal(safeInternalPath(null, "/login"), "/login");
    assert.equal(safeInternalPath("", "/login"), "/login");
    assert.equal(safeInternalPath("   ", "/login"), "/login");
  });
});

describe("redirectIfAuthenticated uses safeInternalPath (M4)", () => {
  it("delegates next= validation to safeInternalPath", () => {
    const helper = readFileSync(
      path.join(process.cwd(), "src/lib/auth/redirect-if-authenticated.ts"),
      "utf8"
    );
    assert.match(helper, /safeInternalPath/);
    assert.doesNotMatch(helper, /nextPath\.startsWith\("\/"\)/);
  });
});

describe("getPublicOrigin", () => {
  function fakeRequest(url: string, headers: Record<string, string>) {
    return {
      url,
      headers: {
        get(name: string) {
          return headers[name.toLowerCase()] ?? null;
        },
      },
    } as unknown as import("next/server").NextRequest;
  }

  it("prefers configured public LMS origin over localhost request.url", () => {
    const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://lms.medversepk.com";
    try {
      const origin = getPublicOrigin(
        fakeRequest("http://localhost:3000/auth/confirm", {
          host: "localhost:3000",
        })
      );
      assert.equal(origin, "https://lms.medversepk.com");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
    }
  });

  it("ignores supabase.co configured URL and uses forwarded host", () => {
    const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://pxoxijlhcvbrostrquft.supabase.co";
    try {
      const origin = getPublicOrigin(
        fakeRequest("http://localhost:3000/auth/confirm", {
          host: "localhost:3000",
          "x-forwarded-host": "lms.medversepk.com",
          "x-forwarded-proto": "https",
        })
      );
      assert.equal(origin, "https://lms.medversepk.com");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
    }
  });
});
