import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  handleRecoveryConfirmPost,
  renderRecoveryConfirmPage,
  type RecoveryVerify,
} from "../../src/lib/auth/recovery-confirm.ts";

const ORIGIN = "https://lms.medversepk.com";
const TOKEN = "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
const confirmUrl = (query: string) => new URL(`${ORIGIN}/auth/confirm?${query}`);
const goodLink = () =>
  confirmUrl(`token_hash=${TOKEN}&type=recovery&next=%2Freset-password`);

function makeVerify(results: Array<{ error: unknown | null }>) {
  const calls: Array<{ type: string; token_hash: string }> = [];
  const verify: RecoveryVerify = async (p) => {
    calls.push(p);
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  return { verify, calls };
}

function formOf(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const goodForm = () =>
  formOf({ token_hash: TOKEN, type: "recovery", next: "/reset-password" });

function post(
  form: FormData,
  verify: RecoveryVerify,
  requestOrigin: string | null = ORIGIN
) {
  return handleRecoveryConfirmPost({
    form,
    requestOrigin,
    publicOrigin: ORIGIN,
    verify,
  });
}

describe("GET/HEAD /auth/confirm are side-effect free", () => {
  it("route GET/HEAD never touch the Supabase client", () => {
    const route = readFileSync("src/app/auth/confirm/route.ts", "utf8");
    const readOnly = route
      .slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"))
      .replace(/\/\/.*$/gm, "");
    assert.match(readOnly, /export async function GET/);
    assert.match(readOnly, /export async function HEAD/);
    assert.doesNotMatch(readOnly, /createClient|verifyOtp|supabase\.auth/);
  });

  it("GET renders a Continue page", async () => {
    const res = renderRecoveryConfirmPage(goodLink(), "GET");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, />Continue</);
    assert.match(html, /<form method="post" action="\/auth\/confirm">/);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("HEAD returns headers only", async () => {
    const res = renderRecoveryConfirmPage(goodLink(), "HEAD");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("sets no-store and noindex headers", () => {
    const res = renderRecoveryConfirmPage(goodLink(), "GET");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  });

  it("page has no script or external assets, no auto-submit, token only in the POST form", async () => {
    const html = await renderRecoveryConfirmPage(goodLink(), "GET").text();
    assert.doesNotMatch(
      html,
      /<script|<link|<img|<iframe|http-equiv="refresh"|onload|autofocus/i
    );
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /localStorage|sessionStorage/);
    // The hash appears exactly once: the hidden POST field. Never in visible
    // text, a link href, or the form action.
    assert.equal(html.split(TOKEN).length - 1, 1);
    assert.match(
      html,
      new RegExp(`<input type="hidden" name="token_hash" value="${TOKEN}">`)
    );
    const visible = html.replace(/<input[^>]*>/g, "").replace(/<[^>]+>/g, " ");
    assert.equal(visible.includes(TOKEN), false);
    assert.doesNotMatch(html, /href="[^"]*token_hash/);
  });

  it("escapes attacker-controlled values and neutralises unsafe next", async () => {
    const xss = await renderRecoveryConfirmPage(
      confirmUrl(`token_hash=${TOKEN}&type=recovery&next=%2F%22%3E%3Cscript%3E`),
      "GET"
    ).text();
    assert.doesNotMatch(xss, /<script/);
    const evil = await renderRecoveryConfirmPage(
      confirmUrl(`token_hash=${TOKEN}&type=recovery&next=%2F%2Fevil.example`),
      "GET"
    ).text();
    assert.match(evil, /name="next" value="\/reset-password"/);
  });

  it("non-recovery or malformed links render the expired state, not a form", async () => {
    for (const q of [
      `token_hash=${TOKEN}&type=signup`,
      `token_hash=${TOKEN}&type=magiclink`,
      `type=recovery`,
      `token_hash=%3Cb%3E&type=recovery`,
    ]) {
      const res = renderRecoveryConfirmPage(confirmUrl(q), "GET");
      assert.equal(res.status, 400, q);
      const html = await res.text();
      assert.doesNotMatch(html, /<form/);
      assert.match(html, /expired or was already used/);
    }
  });
});

describe("POST /auth/confirm (explicit Continue)", () => {
  it("verifies with type=recovery and redirects 303 to /reset-password", async () => {
    const { verify, calls } = makeVerify([{ error: null }]);
    const res = await post(goodForm(), verify);
    assert.deepEqual(calls, [{ type: "recovery", token_hash: TOKEN }]);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password`);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("defaults destination to /reset-password when next is missing", async () => {
    const { verify } = makeVerify([{ error: null }]);
    const res = await post(formOf({ token_hash: TOKEN, type: "recovery" }), verify);
    assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password`);
  });

  it("expired / already-used token shows the expired state, no redirect", async () => {
    const { verify } = makeVerify([
      { error: { message: "Token has expired or is invalid" } },
    ]);
    const res = await post(goodForm(), verify);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("location"), null);
    assert.match(await res.text(), /expired or was already used/);
  });

  it("a thrown verify error is a failure, not success", async () => {
    const res = await post(goodForm(), async () => {
      throw new Error("network");
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("location"), null);
  });

  it("double submission: second use fails and never reports success", async () => {
    const { verify, calls } = makeVerify([
      { error: null },
      { error: { message: "Token has expired or is invalid" } },
    ]);
    const first = await post(goodForm(), verify);
    const second = await post(goodForm(), verify);
    assert.equal(first.status, 303);
    assert.equal(second.status, 400);
    assert.equal(second.headers.get("location"), null);
    assert.equal(calls.length, 2);
  });

  it("rejects non-recovery types without calling verifyOtp", async () => {
    for (const type of ["signup", "magiclink", "email", "invite", "email_change", ""]) {
      const { verify, calls } = makeVerify([{ error: null }]);
      const res = await post(formOf({ token_hash: TOKEN, type }), verify);
      assert.equal(res.status, 400, type);
      assert.equal(calls.length, 0, type);
    }
  });

  it("rejects missing or malformed token_hash without calling verifyOtp", async () => {
    for (const token_hash of ["", "short", "has space in it 12345", "<script>alert(1)</script>"]) {
      const { verify, calls } = makeVerify([{ error: null }]);
      const res = await post(formOf({ token_hash, type: "recovery" }), verify);
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0);
    }
  });

  it("cannot be turned into an open redirect via next", async () => {
    for (const next of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      const { verify } = makeVerify([{ error: null }]);
      const res = await post(
        formOf({ token_hash: TOKEN, type: "recovery", next }),
        verify
      );
      assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password`, next);
    }
  });

  it("rejects cross-origin and Origin-less POSTs before verifying", async () => {
    for (const o of ["https://evil.example", "null", null, "http://lms.medversepk.com"]) {
      const { verify, calls } = makeVerify([{ error: null }]);
      const res = await post(goodForm(), verify, o);
      assert.equal(res.status, 403, String(o));
      assert.equal(calls.length, 0, String(o));
    }
  });
});

describe("route wiring", () => {
  const route = readFileSync("src/app/auth/confirm/route.ts", "utf8");

  it("POST verifies through the cookie-bound server client, without ensure_profile", () => {
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(post, /createClient\(\)/);
    assert.match(post, /supabase\.auth\.verifyOtp\(params\)/);
    assert.match(post, /getPublicOrigin\(request\)/);
    assert.doesNotMatch(route, /ensure_profile/);
  });

  it("does not log URLs or tokens", () => {
    assert.doesNotMatch(route, /console\.|logServerError/);
  });
});
