import { passwordRecoveryNextPath } from "./password-recovery.ts";

/**
 * Two-step recovery confirmation. Email scanners, link previewers and
 * prefetchers issue GET/HEAD, so those must never call verifyOtp (a Supabase
 * recovery token is one-time). Verification happens only on a same-origin
 * POST that the user triggers with the Continue button.
 *
 * Token handoff: the emailed GET stores the token hash in a short-lived,
 * HttpOnly cookie keyed by a random per-flow id and redirects to a clean URL
 * (`?flow=<id>`). The confirmation page and its form carry only the flow id,
 * never the token hash. Cookie name per flow + path scope /auth/confirm keeps
 * two recovery links in separate tabs from overwriting each other.
 */

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const RECOVERY_FLOW_COOKIE_PREFIX = "mv_rc_";
export const RECOVERY_FLOW_COOKIE_PATH = "/auth/confirm";
export const RECOVERY_FLOW_TTL_SECONDS = 600;

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

const PAGE_HEADERS = {
  ...BASE_HEADERS,
  "content-type": "text/html; charset=utf-8",
} as const;

export type RecoveryVerify = (params: {
  type: "recovery";
  token_hash: string;
}) => Promise<{ error: unknown | null }>;

export type ReadCookie = (name: string) => string | undefined;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline style attributes only: the app CSP allows style-src-attr but a bare
// <style> element would need the per-request nonce.
const BODY_STYLE =
  "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f6f7;font-family:Arial,Helvetica,sans-serif;color:#0b1f3a";
const MAIN_STYLE =
  "background:#fff;border-radius:12px;max-width:420px;width:calc(100% - 32px);padding:32px;box-sizing:border-box";
const H1_STYLE = "margin:0 0 12px;font-size:20px";
const P_STYLE = "margin:0 0 20px;font-size:14px;line-height:1.6;color:#5b6b78";
const BTN_STYLE =
  "display:inline-block;background:#05AEA9;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:bold;text-decoration:none;cursor:pointer";

function page(
  title: string,
  body: string,
  status: number,
  extraHeaders: Array<[string, string]> = []
): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · MedVerse LMS</title>
</head><body style="${BODY_STYLE}"><main style="${MAIN_STYLE}">${body}</main></body></html>`;
  const headers = new Headers(PAGE_HEADERS);
  for (const [k, v] of extraHeaders) headers.append(k, v);
  return new Response(html, { status, headers });
}

function isUsableTokenHash(value: string | null): value is string {
  return value !== null && TOKEN_HASH_PATTERN.test(value);
}

export function isValidFlowId(value: unknown): value is string {
  return typeof value === "string" && FLOW_ID_PATTERN.test(value);
}

export function newFlowId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function flowCookieName(flowId: string): string {
  return `${RECOVERY_FLOW_COOKIE_PREFIX}${flowId}`;
}

function flowCookie(
  flowId: string,
  value: string,
  maxAge: number,
  secure: boolean
): string {
  return [
    `${flowCookieName(flowId)}=${value}`,
    `Path=${RECOVERY_FLOW_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function encodeFlow(tokenHash: string, next: string): string {
  return Buffer.from(JSON.stringify({ t: tokenHash, n: next })).toString(
    "base64url"
  );
}

function decodeFlow(raw: string | undefined): { t: string; n: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed.t === "string" &&
      isUsableTokenHash(parsed.t) &&
      typeof parsed.n === "string"
    ) {
      return { t: parsed.t, n: parsed.n };
    }
  } catch {
    // fall through
  }
  return null;
}

export function invalidLinkResponse(
  extraHeaders: Array<[string, string]> = []
): Response {
  return page(
    "Link expired",
    `<h1 style="${H1_STYLE}">This reset link has expired or was already used</h1>
<p style="${P_STYLE}">Password reset links work once and expire after one hour. Request a new link to continue.</p>
<a style="${BTN_STYLE}" href="/forgot-password">Request a new link</a>`,
    400,
    extraHeaders
  );
}

/**
 * GET/HEAD /auth/confirm. No Auth call is ever made here.
 *  - `?flow=<id>` with a matching cookie: render the Continue page (flow id only).
 *  - `?token_hash&type=recovery` (the emailed link): GET stores the token in a
 *    flow cookie and 303s to `?flow=<id>`; HEAD answers 204 and sets nothing.
 */
export function handleRecoveryConfirmGet(params: {
  url: URL;
  method: "GET" | "HEAD";
  readCookie: ReadCookie;
  secure: boolean;
  makeFlowId?: () => string;
}): Response {
  const { url, method, readCookie, secure } = params;
  const head = method === "HEAD";
  const flow = url.searchParams.get("flow");
  const tokenHash = url.searchParams.get("token_hash");

  if (tokenHash !== null || url.searchParams.get("type") !== null) {
    if (
      url.searchParams.get("type") !== "recovery" ||
      !isUsableTokenHash(tokenHash)
    ) {
      return head
        ? new Response(null, { status: 400, headers: BASE_HEADERS })
        : invalidLinkResponse();
    }
    if (head) {
      return new Response(null, { status: 204, headers: BASE_HEADERS });
    }
    const flowId = (params.makeFlowId ?? newFlowId)();
    const next = passwordRecoveryNextPath(url.searchParams.get("next"));
    const headers = new Headers(BASE_HEADERS);
    headers.set("location", `${RECOVERY_FLOW_COOKIE_PATH}?flow=${flowId}`);
    headers.append(
      "set-cookie",
      flowCookie(
        flowId,
        encodeFlow(tokenHash, next),
        RECOVERY_FLOW_TTL_SECONDS,
        secure
      )
    );
    return new Response(null, { status: 303, headers });
  }

  if (!isValidFlowId(flow) || !decodeFlow(readCookie(flowCookieName(flow)))) {
    return head
      ? new Response(null, { status: 400, headers: BASE_HEADERS })
      : invalidLinkResponse();
  }
  if (head) return new Response(null, { status: 200, headers: PAGE_HEADERS });
  return page(
    "Reset your password",
    `<h1 style="${H1_STYLE}">Continue resetting your password</h1>
<p style="${P_STYLE}">You are about to choose a new password for your MedVerse LMS account. Press Continue to proceed.</p>
<form method="post" action="${RECOVERY_FLOW_COOKIE_PATH}">
<input type="hidden" name="flow" value="${escapeHtml(flow)}">
<button type="submit" style="${BTN_STYLE}">Continue</button>
</form>`,
    200
  );
}

/**
 * Same-origin guard for the POST. Browsers always send Origin on form POSTs;
 * a missing or foreign Origin is rejected.
 */
export function isSameOriginPost(
  requestOrigin: string | null,
  publicOrigin: string
): boolean {
  return requestOrigin !== null && requestOrigin === publicOrigin;
}

export async function handleRecoveryConfirmPost(params: {
  form: FormData;
  requestOrigin: string | null;
  publicOrigin: string;
  readCookie: ReadCookie;
  secure: boolean;
  verify: RecoveryVerify;
}): Promise<Response> {
  const { form, requestOrigin, publicOrigin, readCookie, secure, verify } =
    params;

  if (!isSameOriginPost(requestOrigin, publicOrigin)) {
    return new Response(null, { status: 403, headers: BASE_HEADERS });
  }

  const flow = form.get("flow");
  if (!isValidFlowId(flow)) return invalidLinkResponse();

  // The flow cookie is single-use whatever the outcome: clear it on every
  // path past this point so a replayed POST cannot re-run verification.
  const clear: Array<[string, string]> = [
    ["set-cookie", flowCookie(flow, "", 0, secure)],
  ];
  const stored = decodeFlow(readCookie(flowCookieName(flow)));
  if (!stored) return invalidLinkResponse(clear);

  let error: unknown | null;
  try {
    ({ error } = await verify({ type: "recovery", token_hash: stored.t }));
  } catch {
    error = true;
  }
  if (error) return invalidLinkResponse(clear);

  // Recovery: a session is enough for /reset-password. No profile RPC here
  // (see password-recovery.ts).
  const dest = passwordRecoveryNextPath(stored.n);
  const headers = new Headers(BASE_HEADERS);
  headers.set("location", `${publicOrigin}${dest}`);
  for (const [k, v] of clear) headers.append(k, v);
  return new Response(null, { status: 303, headers });
}
