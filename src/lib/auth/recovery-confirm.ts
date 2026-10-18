import { passwordRecoveryNextPath } from "./password-recovery.ts";

/**
 * Two-step recovery confirmation. Email scanners, link previewers and
 * prefetchers issue GET/HEAD, so those must never call verifyOtp (a Supabase
 * recovery token is one-time). Verification happens only on a same-origin
 * POST that the user triggers with the Continue button.
 */

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

export type RecoveryVerify = (params: {
  type: "recovery";
  token_hash: string;
}) => Promise<{ error: unknown | null }>;

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

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · MedVerse LMS</title>
</head><body style="${BODY_STYLE}"><main style="${MAIN_STYLE}">${body}</main></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

/** Fields are validated again on POST; invalid GETs get the generic state. */
function isUsableTokenHash(value: string | null): value is string {
  return value !== null && TOKEN_HASH_PATTERN.test(value);
}

export function invalidLinkResponse(): Response {
  return page(
    "Link expired",
    `<h1 style="${H1_STYLE}">This reset link has expired or was already used</h1>
<p style="${P_STYLE}">Password reset links work once and expire after one hour. Request a new link to continue.</p>
<a style="${BTN_STYLE}" href="/forgot-password">Request a new link</a>`,
    400
  );
}

/**
 * GET/HEAD: render the confirmation page. No Auth call, no cookies set. The
 * token is only placed in the POST form body (never in a URL, link or script).
 */
export function renderRecoveryConfirmPage(url: URL, method: string): Response {
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (type !== "recovery" || !isUsableTokenHash(tokenHash)) {
    return method === "HEAD"
      ? new Response(null, { status: 400, headers: PAGE_HEADERS })
      : invalidLinkResponse();
  }
  const next = passwordRecoveryNextPath(url.searchParams.get("next"));
  const res = page(
    "Reset your password",
    `<h1 style="${H1_STYLE}">Continue resetting your password</h1>
<p style="${P_STYLE}">You are about to choose a new password for your MedVerse LMS account. Press Continue to proceed.</p>
<form method="post" action="/auth/confirm">
<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}">
<input type="hidden" name="type" value="recovery">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit" style="${BTN_STYLE}">Continue</button>
</form>`,
    200
  );
  return method === "HEAD"
    ? new Response(null, { status: 200, headers: PAGE_HEADERS })
    : res;
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
  verify: RecoveryVerify;
}): Promise<Response> {
  const { form, requestOrigin, publicOrigin, verify } = params;

  if (!isSameOriginPost(requestOrigin, publicOrigin)) {
    return new Response(null, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  const next = form.get("next");
  if (
    type !== "recovery" ||
    typeof tokenHash !== "string" ||
    !isUsableTokenHash(tokenHash)
  ) {
    return invalidLinkResponse();
  }

  let error: unknown | null;
  try {
    ({ error } = await verify({ type: "recovery", token_hash: tokenHash }));
  } catch {
    error = true;
  }
  if (error) return invalidLinkResponse();

  // Recovery: a session is enough for /reset-password. ensure_profile is
  // intentionally not called (see password-recovery.ts).
  const dest = passwordRecoveryNextPath(typeof next === "string" ? next : null);
  return new Response(null, {
    status: 303,
    headers: { location: `${publicOrigin}${dest}`, "cache-control": "no-store" },
  });
}
