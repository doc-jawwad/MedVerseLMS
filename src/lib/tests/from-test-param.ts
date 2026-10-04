/** Validate ?fromTest= for Test Builder → Question Bank round-trips. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFromTestId(
  value: string | string[] | undefined
): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}
