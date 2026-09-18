// Shared refuse-list for ops scripts. Project refs are documented in docs/deployment.md.
export const CLOUD_PRODUCTION_REF = "pxoxijlhcvbrostrquft";
export const CLOUD_STAGING_REF = "vygtwrsshcyfahfzurgq";

export function looksLikeCloudSupabase(value) {
  const v = String(value ?? "");
  return (
    v.includes("supabase.co") ||
    v.includes("pooler.supabase.com") ||
    v.includes(CLOUD_PRODUCTION_REF) ||
    v.includes(CLOUD_STAGING_REF)
  );
}

export function assertNotCloudProduction(url, { allowStaging = false } = {}) {
  const v = String(url ?? "");
  if (v.includes(CLOUD_PRODUCTION_REF) && process.env.MEDVERSE_ALLOW_PRODUCTION !== "yes") {
    throw new Error(
      "Refusing Cloud production project. Set MEDVERSE_ALLOW_PRODUCTION=yes only for an explicit, approved production operation."
    );
  }
  if (!allowStaging && v.includes(CLOUD_STAGING_REF) && process.env.MEDVERSE_ALLOW_CLOUD_STAGING !== "yes") {
    throw new Error(
      "Refusing Cloud staging project. Set MEDVERSE_ALLOW_CLOUD_STAGING=yes only when staging use is approved."
    );
  }
}
