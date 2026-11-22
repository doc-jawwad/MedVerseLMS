import type { AcademicSearchHit, AcademicTreeSurface } from "./types.ts";
import { PROF_SESSION_LABEL } from "./product-structure.ts";
import { hrefForAcademicSearchHit } from "./hit-href.ts";

/** Kinds returned by tree search — never item / stem / PDF payload kinds. */
export const ACADEMIC_SEARCH_KINDS = new Set<AcademicSearchHit["kind"]>([
  "class",
  "block",
  "category",
  "folder",
  "day",
  "prof_session",
]);

export type AcademicSearchRpcRow = {
  kind?: string;
  id?: string;
  name?: string;
  path_labels?: unknown;
  locked?: boolean;
  product_key?: string | null;
};

/**
 * Prefer authoritative RPC hits when present; otherwise structural chrome.
 * Empty successful RPC must not block structural fallback (e.g. One Liner).
 */
export function resolveAcademicSearchHits(input: {
  rpcHits: AcademicSearchHit[] | null;
  structuralHits: AcademicSearchHit[];
}): AcademicSearchHit[] {
  if (input.rpcHits && input.rpcHits.length > 0) return input.rpcHits;
  return input.structuralHits;
}

/**
 * Free / resources surface must not surface Prof. Session chrome or days
 * (architecture: entire Prof. Session is subscription-locked).
 * Also drop locked folder hits so search only lists accessible containers.
 */
export function filterSearchHitsForAccess(input: {
  hits: AcademicSearchHit[];
  surface: AcademicTreeSurface;
  hasLiveSubscription: boolean;
}): AcademicSearchHit[] {
  const allowProf =
    input.hasLiveSubscription && input.surface === "library";

  return input.hits.filter((hit) => {
    if (!ACADEMIC_SEARCH_KINDS.has(hit.kind)) return false;
    if (hit.kind === "folder" && hit.locked) return false;
    if (hit.kind === "day" && !allowProf) return false;
    if (hit.kind === "prof_session" && !allowProf) return false;
    if (
      !allowProf &&
      hit.path_labels.some(
        (l) => normalizeLabel(l) === normalizeLabel(PROF_SESSION_LABEL)
      )
    ) {
      return false;
    }
    return true;
  });
}

export function mapAcademicSearchRpcRows(input: {
  rows: AcademicSearchRpcRow[];
  yearName: string;
  surface: AcademicTreeSurface;
}): AcademicSearchHit[] {
  return input.rows.map((row) => {
    const path_labels = Array.isArray(row.path_labels)
      ? row.path_labels.map(String)
      : [input.yearName, String(row.name ?? "")];
    const rawKind = String(row.kind ?? "");
    const kind: AcademicSearchHit["kind"] =
      rawKind === "class" ||
      rawKind === "block" ||
      rawKind === "category" ||
      rawKind === "folder" ||
      rawKind === "day" ||
      rawKind === "prof_session"
        ? rawKind
        : rawKind === "prof_session_day"
          ? "day"
          : "folder";
    const product_key =
      typeof row.product_key === "string" ? row.product_key : null;
    const partial = {
      kind,
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      path_labels,
      locked: Boolean(row.locked),
      class_name: input.yearName,
      product_key,
    };
    return {
      kind: partial.kind,
      id: partial.id,
      name: partial.name,
      path_labels: partial.path_labels,
      locked: partial.locked,
      class_name: partial.class_name,
      href: hrefForAcademicSearchHit(partial, input.surface),
    };
  });
}

/** True when PostgREST/RPC error should degrade to structural search. */
export function isSearchRpcCompatError(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883") ||
    msg.includes("no_active_enrollment") ||
    msg.includes("not_authenticated") ||
    msg.includes("account_not_eligible") ||
    msg.includes("invalid_surface")
  );
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}
