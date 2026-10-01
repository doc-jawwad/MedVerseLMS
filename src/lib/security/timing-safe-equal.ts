import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time UTF-8 string compare. Length mismatches still touch
 * timingSafeEqual (self-compare) so short-circuit timing is flatter.
 */
export function timingSafeEqualUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Compare Authorization header to `Bearer ${secret}` without leaking the secret. */
export function timingSafeEqualBearer(
  authHeader: string | null | undefined,
  secret: string
): boolean {
  const expected = `Bearer ${secret}`;
  if (authHeader == null) {
    timingSafeEqualUtf8(expected, expected);
    return false;
  }
  return timingSafeEqualUtf8(authHeader, expected);
}
