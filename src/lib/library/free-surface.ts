/**
 * Free Resources membership (presentation only).
 *
 * Same entitlement columns + personal grants as the rest of the LMS —
 * not a second store. Subscribers keep paid items in the full library;
 * Free Resources only lists curated free entitlement and/or a personal grant.
 * Content RPCs remain authoritative for open/fetch.
 */
export function belongsOnFreeResources(input: {
  entitlement: string | null | undefined;
  hasPersonalGrant?: boolean;
  /** Already passed can_access / granted for this student. */
  accessible: boolean;
}): boolean {
  if (!input.accessible) return false;
  if (input.entitlement === "free") return true;
  return Boolean(input.hasPersonalGrant);
}
