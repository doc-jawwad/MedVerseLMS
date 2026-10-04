/**
 * Auth/DB-split college promotion helper.
 *
 * Authoritative leaderboard college is profiles.college_name.
 * Registration stores college in Auth user_metadata; ensure_profile heals the
 * caller's own row. On hosts without co-located auth.users, peers keep a
 * blank profiles.college_name until an ops backfill (or their next login).
 *
 * Never overwrite a non-empty profiles.college_name (profile edit wins).
 */

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Returns the college to write into profiles.college_name, or null when no
 * update should occur.
 */
export function resolveCollegeBackfill(
  profileCollege: string | null | undefined,
  authCollege: string | null | undefined
): string | null {
  if (nonEmpty(profileCollege)) return null;
  return nonEmpty(authCollege);
}
