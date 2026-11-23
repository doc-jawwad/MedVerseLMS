/**
 * Resolve a student contact number for the permission-gated Admin Student 360.
 * Signup stores contact_number in Auth user metadata, not profiles.
 * Never use this editable metadata for authorization.
 */
function asContact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contact = value.trim();
  return contact.length > 0 ? contact : null;
}

export async function resolveAdminStudentContact(args: {
  canReadBiodata: boolean;
  profileContact: unknown;
  loadAuthMetadata: () => Promise<unknown>;
}): Promise<string | null> {
  // No privileged Auth lookup for analytics/payment-only viewers.
  if (!args.canReadBiodata) return null;
  const stored = asContact(args.profileContact);
  if (stored) return stored;

  try {
    const metadata = await args.loadAuthMetadata();
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    return asContact((metadata as Record<string, unknown>).contact_number);
  } catch {
    // A transient Auth failure must not take down the rest of Student 360.
    return null;
  }
}
