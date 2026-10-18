import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  flowCookieName,
  handleRecoveryConfirmGet,
  handleRecoveryConfirmPost,
  isValidFlowId,
  newFlowId,
  type RecoveryVerify,
} from "../../src/lib/auth/recovery-confirm.ts";

const ORIGIN = "https://lms.medversepk.com";
const TOKEN = "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
const TOKEN_B = "zzz999yyy888xxx777www666vvv555uuu444ttt333sss222rr";
const emailLink = (token = TOKEN, extra = "") =>
  new URL(
    `${ORIGIN}/auth/confirm?token_hash=${token}&type=recovery&next=%2Freset-password${extra}`
  );

/** Minimal browser cookie jar: applies Set-Cookie headers, honours Max-Age=0. */
class Jar {
  cookies = new Map<string, string>();
  apply(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (attrs.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  read = (name: string) => this.cookies.get(name);
}

function get(url: URL, jar: Jar, method: "GET" | "HEAD" = "GET") {
  const res = handleRecoveryConfirmGet({
    url,
    method,
    readCookie: jar.read,
    secure: true,
  });
  jar.apply(res);
  return res;
}

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

function post(
  flow: string,
  jar: Jar,
  verify: RecoveryVerify,
  requestOrigin: string | null = ORIGIN
) {
  return handleRecoveryConfirmPost({
    form: formOf({ flow }),
    requestOrigin,
    publicOrigin: ORIGIN,
    readCookie: jar.read,
    secure: true,
    verify,
  }).then((res) => {
    jar.apply(res);
    return res;
  });
}

/** Emailed-link GET, then follow the redirect to the clean page. */
async function openLink(jar: Jar, token = TOKEN, extra = "") {
  const redirect = get(emailLink(token, extra), jar);
  assert.equal(redirect.status, 303);
  const location = redirect.headers.get("location")!;
  const flow = new URL(location, ORIGIN).searchParams.get("flow")!;
  const pageRes = get(new URL(location, ORIGIN), jar);
  return { redirect, location, flow, pageRes };
}

describe("GET/HEAD /auth/confirm are side-effect free", () => {
  it("route GET/HEAD never touch the Supabase client", () => {
    const route = readFileSync("src/app/auth/confirm/route.ts", "utf8");
    const readOnly = route
      .slice(route.indexOf("function get("), route.indexOf("export async function POST"))
      .replace(/\/\/.*$/gm, "");
    assert.match(readOnly, /export async function GET/);
    assert.match(readOnly, /export async function HEAD/);
    assert.doesNotMatch(readOnly, /createClient|verifyOtp|supabase\.auth/);
    // The handler module has no Supabase import at all; verify is injected.
    const lib = readFileSync("src/lib/auth/recovery-confirm.ts", "utf8");
    const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(libCode, /supabase|createClient|@\//i);
  });

  it("emailed GET redirects to a clean URL with no token and sets a flow cookie", async () => {
    const jar = new Jar();
    const { redirect, location } = await openLink(jar);
    assert.match(location, /^\/auth\/confirm\?flow=[A-Za-z0-9_-]{22}$/);
    assert.equal(location.includes(TOKEN), false);
    assert.equal(redirect.headers.get("cache-control"), "no-store");
    assert.equal(redirect.headers.get("x-robots-tag"), "noindex, nofollow");
    const [setCookie] = redirect.headers.getSetCookie();
    assert.match(setCookie, /^mv_rc_[A-Za-z0-9_-]{22}=/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/auth/confirm", "Max-Age=600"]) {
      assert.ok(setCookie.includes(attr), attr);
    }
  });

  it("HEAD sets no cookie, redirects nowhere and reveals nothing", async () => {
    const jar = new Jar();
    const res = get(emailLink(), jar, "HEAD");
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("location"), null);
    assert.equal(res.headers.getSetCookie().length, 0);
    assert.equal(await res.text(), "");
    assert.equal(jar.cookies.size, 0);
  });

  it("confirmation page carries a flow id only, never the token hash", async () => {
    const jar = new Jar();
    const { pageRes, flow } = await openLink(jar);
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get("cache-control"), "no-store");
    assert.equal(pageRes.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(pageRes.headers.getSetCookie().length, 0);
    const html = await pageRes.text();
    assert.equal(html.includes(TOKEN), false);
    assert.equal(html.includes(Buffer.from(TOKEN).toString("base64")), false);
    assert.match(html, />Continue</);
    assert.match(html, new RegExp(`<input type="hidden" name="flow" value="${flow}">`));
    assert.doesNotMatch(html, /<script|<link|<img|<iframe|http-equiv="refresh"|onload|autofocus/i);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /localStorage|sessionStorage/);
    // Cookie is HttpOnly in the real browser; the page itself has no script
    // that could read client-visible state.
  });

  it("HEAD on the clean URL is headers-only", async () => {
    const jar = new Jar();
    const { location } = await openLink(jar);
    const res = get(new URL(location, ORIGIN), jar, "HEAD");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
  });

  it("non-recovery or malformed emailed links fail safely and set no cookie", async () => {
    for (const q of [
      `token_hash=${TOKEN}&type=signup`,
      `token_hash=${TOKEN}&type=magiclink`,
      `type=recovery`,
      `token_hash=%3Cb%3E&type=recovery`,
    ]) {
      const jar = new Jar();
      const res = get(new URL(`${ORIGIN}/auth/confirm?${q}`), jar);
      assert.equal(res.status, 400, q);
      assert.equal(jar.cookies.size, 0, q);
      const html = await res.text();
      assert.doesNotMatch(html, /<form/);
      assert.match(html, /expired or was already used/);
    }
  });

  it("unknown, malformed or cookie-less flow ids fail safely", async () => {
    const jar = new Jar();
    for (const flow of ["", "short", "AAAAAAAAAAAAAAAAAAAAAA", "<script>aaaaaaaaaaaaaaa", newFlowId()]) {
      const res = get(new URL(`${ORIGIN}/auth/confirm?flow=${encodeURIComponent(flow)}`), jar);
      assert.equal(res.status, 400, flow);
      assert.doesNotMatch(await res.text(), /<form/);
    }
    assert.equal(get(new URL(`${ORIGIN}/auth/confirm`), jar).status, 400);
  });

  it("flow cookie with a corrupted value is rejected", () => {
    const jar = new Jar();
    const id = newFlowId();
    jar.cookies.set(flowCookieName(id), "not-base64-json!!");
    assert.equal(get(new URL(`${ORIGIN}/auth/confirm?flow=${id}`), jar).status, 400);
  });

  it("flow ids are 128-bit random and well-formed", () => {
    const ids = new Set(Array.from({ length: 50 }, newFlowId));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.ok(isValidFlowId(id));
  });

  it("uses Secure only on https origins", () => {
    const res = handleRecoveryConfirmGet({
      url: emailLink(),
      method: "GET",
      readCookie: () => undefined,
      secure: false,
    });
    assert.doesNotMatch(res.headers.getSetCookie()[0], /Secure/);
  });
});

describe("POST /auth/confirm (explicit Continue)", () => {
  it("verifies the cookie's token as recovery and redirects 303 to /reset-password", async () => {
    const jar = new Jar();
    const { flow } = await openLink(jar);
    const { verify, calls } = makeVerify([{ error: null }]);
    const res = await post(flow, jar, verify);
    assert.deepEqual(calls, [{ type: "recovery", token_hash: TOKEN }]);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    // Flow cookie is cleared (single use).
    assert.equal(jar.cookies.has(flowCookieName(flow)), false);
  });

  it("expired / already-used token shows the expired state, no redirect", async () => {
    const jar = new Jar();
    const { flow } = await openLink(jar);
    const { verify } = makeVerify([{ error: { message: "Token has expired or is invalid" } }]);
    const res = await post(flow, jar, verify);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("location"), null);
    assert.match(await res.text(), /expired or was already used/);
    assert.equal(jar.cookies.has(flowCookieName(flow)), false);
  });

  it("a thrown verify error is a failure, not success", async () => {
    const jar = new Jar();
    const { flow } = await openLink(jar);
    const res = await post(flow, jar, async () => {
      throw new Error("network");
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("location"), null);
  });

  it("repeat submission cannot re-verify or report success", async () => {
    const jar = new Jar();
    const { flow } = await openLink(jar);
    const { verify, calls } = makeVerify([{ error: null }]);
    const first = await post(flow, jar, verify);
    const second = await post(flow, jar, verify);
    assert.equal(first.status, 303);
    assert.equal(second.status, 400);
    assert.equal(second.headers.get("location"), null);
    assert.equal(calls.length, 1);
  });

  it("missing, malformed or unknown flow id never calls verifyOtp", async () => {
    const jar = new Jar();
    await openLink(jar);
    for (const flow of ["", "short", "<script>", newFlowId()]) {
      const { verify, calls } = makeVerify([{ error: null }]);
      const res = await post(flow, jar, verify);
      assert.equal(res.status, 400, flow);
      assert.equal(calls.length, 0, flow);
    }
    const { verify, calls } = makeVerify([{ error: null }]);
    const res = await handleRecoveryConfirmPost({
      form: new FormData(),
      requestOrigin: ORIGIN,
      publicOrigin: ORIGIN,
      readCookie: jar.read,
      secure: true,
      verify,
    });
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  it("a type posted in the body cannot change the verify type", async () => {
    const jar = new Jar();
    const { flow } = await openLink(jar);
    const { verify, calls } = makeVerify([{ error: null }]);
    await handleRecoveryConfirmPost({
      form: formOf({ flow, type: "signup", token_hash: "x".repeat(20), next: "//evil.example" }),
      requestOrigin: ORIGIN,
      publicOrigin: ORIGIN,
      readCookie: jar.read,
      secure: true,
      verify,
    });
    assert.deepEqual(calls, [{ type: "recovery", token_hash: TOKEN }]);
  });

  it("rejects cross-origin and Origin-less POSTs before verifying", async () => {
    for (const o of ["https://evil.example", "null", null, "http://lms.medversepk.com"]) {
      const jar = new Jar();
      const { flow } = await openLink(jar);
      const { verify, calls } = makeVerify([{ error: null }]);
      const res = await post(flow, jar, verify, o);
      assert.equal(res.status, 403, String(o));
      assert.equal(calls.length, 0, String(o));
      // A rejected cross-origin request must not burn the legitimate flow.
      assert.equal(jar.cookies.has(flowCookieName(flow)), true, String(o));
    }
  });

  it("cannot be turned into an open redirect via next", async () => {
    for (const next of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      const jar = new Jar();
      const { flow } = await openLink(jar, TOKEN, `&x=1`);
      // Re-issue with the hostile next in the emailed link itself.
      const hostile = new URL(
        `${ORIGIN}/auth/confirm?token_hash=${TOKEN}&type=recovery&next=${encodeURIComponent(next)}`
      );
      const redirect = get(hostile, jar);
      const hostileFlow = new URL(redirect.headers.get("location")!, ORIGIN).searchParams.get("flow")!;
      assert.notEqual(hostileFlow, flow);
      const { verify } = makeVerify([{ error: null }]);
      const res = await post(hostileFlow, jar, verify);
      assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password`, next);
    }
  });

  it("keeps a safe internal next", async () => {
    const jar = new Jar();
    const redirect = get(
      new URL(`${ORIGIN}/auth/confirm?token_hash=${TOKEN}&type=recovery&next=%2Freset-password%3Fx%3D1`),
      jar
    );
    const flow = new URL(redirect.headers.get("location")!, ORIGIN).searchParams.get("flow")!;
    const res = await post(flow, jar, makeVerify([{ error: null }]).verify);
    assert.equal(res.headers.get("location"), `${ORIGIN}/reset-password?x=1`);
  });
});

describe("two recovery flows in separate tabs", () => {
  it("do not overwrite each other and each verifies its own token", async () => {
    const jar = new Jar();
    const a = await openLink(jar, TOKEN);
    const b = await openLink(jar, TOKEN_B);
    assert.notEqual(a.flow, b.flow);
    assert.equal(jar.cookies.size, 2);
    const { verify, calls } = makeVerify([{ error: null }]);
    await post(a.flow, jar, verify);
    // Flow A being consumed leaves flow B intact.
    assert.equal(jar.cookies.has(flowCookieName(b.flow)), true);
    await post(b.flow, jar, verify);
    assert.deepEqual(
      calls.map((c) => c.token_hash),
      [TOKEN, TOKEN_B]
    );
  });
});

describe("route wiring", () => {
  const route = readFileSync("src/app/auth/confirm/route.ts", "utf8");

  it("POST verifies through the cookie-bound server client", () => {
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(post, /createClient\(\)/);
    assert.match(post, /supabase\.auth\.verifyOtp\(params\)/);
    assert.match(post, /getPublicOrigin\(request\)/);
    assert.match(post, /request\.cookies\.get/);
  });

  it("makes no profile RPC and does not log URLs, cookies or tokens", () => {
    assert.doesNotMatch(route, /\.rpc\(|console\.|logServerError/);
    const lib = readFileSync("src/lib/auth/recovery-confirm.ts", "utf8");
    assert.doesNotMatch(lib, /\.rpc\(|console\./);
  });
});
