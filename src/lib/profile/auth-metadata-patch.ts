/** GoTrue merges user metadata; omitted keys are retained. Send null to remove a key. */
export function authMetadataPatch(
  patch: Record<string, string | null>
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key,
      value == null || value === "" ? null : value,
    ])
  );
}
