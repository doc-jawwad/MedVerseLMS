/** Same-origin avatar proxy paths (no R2 signed URLs in the browser). */
export function avatarProxyUrl(
  studentId: "me" | string,
  cacheBust?: string | null
): string {
  const base =
    studentId === "me"
      ? "/api/avatars/me"
      : `/api/avatars/${encodeURIComponent(studentId)}`;
  const bust = cacheBust?.trim();
  if (!bust) return base;
  // Use the object filename (uuid) only — not the full key path.
  const token = bust.includes("/") ? bust.split("/").pop() || bust : bust;
  return `${base}?v=${encodeURIComponent(token)}`;
}
