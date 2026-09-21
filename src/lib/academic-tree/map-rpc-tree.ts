import type {
  AcademicProfSession,
  AcademicTree,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeSubject,
  BlockCategoryId,
  BlockProductKey,
  GetAcademicTreeInput,
} from "./types.ts";
import {
  BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  classDisplayName,
  isBlockProductKey,
} from "./product-structure.ts";

/**
 * Map Data Spine `get_academic_tree` jsonb into the AcademicTree UI model.
 * Never attaches Drive URLs, stems, or correct_key.
 *
 * Product keys come from RPC `product_key` (authoritative). Prof. Session
 * days are Admin-created only — empty when RPC returns none (no Day 1–3 invent).
 */
export function mapRpcTree(
  raw: unknown,
  input: GetAcademicTreeInput
): AcademicTree | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.subjects)) {
    return null;
  }

  const yearId =
    typeof row.year_id === "string" ? row.year_id : input.year_id;
  const yearNumber =
    typeof row.year_number === "number"
      ? row.year_number
      : input.year_number;
  const yearName = classDisplayName(
    yearNumber,
    typeof row.year_name === "string" ? row.year_name : input.year_name
  );

  const libraryLocked =
    input.surface === "library" && !input.has_live_subscription;

  const mappedByKey = new Map<BlockProductKey, AcademicTreeSubject>();
  for (const subjectRaw of row.subjects) {
    const mapped = mapRpcSubject(subjectRaw);
    if (mapped) mappedByKey.set(mapped.product_key, mapped);
  }

  const subjects: AcademicTreeSubject[] = blocksForYearNumber(yearNumber).map(
    (def) => {
      const existing = mappedByKey.get(def.key);
      if (existing) {
        return {
          ...existing,
          // Prefer canonical product display name from product_key defs.
          name: def.name,
          categories: ensureEightCategories(existing.categories),
        };
      }
      return {
        subject_id: `product:${def.key}`,
        product_key: def.key,
        name: def.name,
        locked: libraryLocked,
        categories: emptyEightCategories(libraryLocked),
      };
    }
  );

  const prof_session = mapRpcProfSession(row.prof_session, libraryLocked);

  return {
    surface: input.surface,
    year_id: yearId,
    year_number: yearNumber,
    year_name: yearName,
    subjects,
    prof_session,
    from_adapter: false,
  };
}

function mapRpcProfSession(
  raw: unknown,
  libraryLocked: boolean
): AcademicProfSession {
  if (!raw || typeof raw !== "object") {
    return { locked: libraryLocked, days: [] };
  }
  const row = raw as Record<string, unknown>;
  const daysRaw = Array.isArray(row.days) ? row.days : [];
  const days = daysRaw
    .map((d) => mapRpcProfDay(d))
    .filter((f): f is AcademicTreeFolder => Boolean(f));
  return {
    locked: row.locked != null ? Boolean(row.locked) : libraryLocked,
    days,
  };
}

/** Data Spine day shape: `{ day_id, name, sort_order, slots: [{ slot_key, name }] }`. */
function mapRpcProfDay(raw: unknown): AcademicTreeFolder | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const dayId =
    typeof row.day_id === "string"
      ? row.day_id
      : typeof row.folder_id === "string"
        ? row.folder_id
        : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!dayId || !name) return null;

  const slotsRaw = Array.isArray(row.slots) ? row.slots : [];
  const children: AcademicTreeFolder[] = [];
  for (const slotRaw of slotsRaw) {
    if (!slotRaw || typeof slotRaw !== "object") continue;
    const slot = slotRaw as Record<string, unknown>;
    const key =
      typeof slot.slot_key === "string" ? slot.slot_key : "";
    const def = TEST_DAY_SLOTS.find((s) => s.id === key);
    if (!def) continue;
    children.push({
      id: `${dayId}:${def.id}`,
      slug: def.slug,
      name:
        typeof slot.name === "string" && slot.name.trim()
          ? slot.name.trim()
          : def.name,
      locked: false,
      parent_id: dayId,
      children: [],
      items: [],
      day_slot: def.id,
    });
  }

  // Ensure fixed chrome even if RPC omitted a slot row.
  if (children.length === 0) {
    for (const def of TEST_DAY_SLOTS) {
      children.push({
        id: `${dayId}:${def.id}`,
        slug: def.slug,
        name: def.name,
        locked: false,
        parent_id: dayId,
        children: [],
        items: [],
        day_slot: def.id,
      });
    }
  }

  return {
    id: dayId,
    // Stable URL slug = day UUID (Admin may rename freely).
    slug: dayId,
    name,
    locked: Boolean(row.locked),
    parent_id: null,
    children,
    items: [],
    is_day: true,
  };
}

function emptyEightCategories(locked: boolean): AcademicTreeCategory[] {
  return BLOCK_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.name,
    locked,
    placeholder: cat.placeholder,
    folders: [],
  }));
}

function ensureEightCategories(
  categories: AcademicTreeCategory[]
): AcademicTreeCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return BLOCK_CATEGORIES.map((def) => {
    const existing = byId.get(def.id);
    if (existing) {
      return {
        ...existing,
        name: existing.name || def.name,
        placeholder: existing.placeholder ?? def.placeholder,
      };
    }
    return {
      id: def.id,
      name: def.name,
      locked: false,
      placeholder: def.placeholder,
      folders: [],
    };
  });
}

function mapRpcSubject(raw: unknown): AcademicTreeSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subjectId =
    typeof row.subject_id === "string" ? row.subject_id : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!subjectId || !name) return null;

  const rawKey =
    typeof row.product_key === "string" ? row.product_key.trim() : "";
  if (!isBlockProductKey(rawKey)) {
    // Ignore departmental / unmapped subjects — chrome is product_key only.
    return null;
  }

  const categoriesRaw = Array.isArray(row.categories) ? row.categories : [];
  const categories: AcademicTreeCategory[] = [];
  for (const catRaw of categoriesRaw) {
    const cat = mapRpcCategory(catRaw);
    if (cat) categories.push(cat);
  }

  const def = BLOCK_PRODUCT_DEFS.find((b) => b.key === rawKey);

  return {
    subject_id: subjectId,
    product_key: rawKey,
    name: def?.name ?? name,
    locked: Boolean(row.locked),
    categories,
  };
}

function mapRpcCategory(raw: unknown): AcademicTreeCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const libraryType =
    typeof row.library_type === "string" ? row.library_type : "";
  const id = categoryIdFromLibraryType(libraryType);
  if (!id) return null;

  const known = BLOCK_CATEGORIES.find((c) => c.id === id);
  const foldersRaw = Array.isArray(row.folders) ? row.folders : [];
  const folders = foldersRaw
    .map((f) => mapRpcFolder(f))
    .filter((f): f is AcademicTreeFolder => Boolean(f));

  return {
    id,
    name:
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : known?.name ?? libraryType,
    locked: Boolean(row.locked),
    placeholder: Boolean(row.placeholder),
    folders,
  };
}

function mapRpcFolder(raw: unknown): AcademicTreeFolder | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.folder_id === "string" ? row.folder_id : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return null;

  const dayMatch = /^day\s*(\d+)$/i.exec(name);
  const slug = dayMatch
    ? `day-${dayMatch[1]}`
    : name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || id;

  return {
    id,
    slug,
    name,
    locked: Boolean(row.locked),
    parent_id: typeof row.parent_id === "string" ? row.parent_id : null,
    children: [],
    items: [],
    is_day: Boolean(dayMatch),
  };
}

function categoryIdFromLibraryType(
  libraryType: string
): BlockCategoryId | null {
  switch (libraryType) {
    case "mcq_bank":
      return "mcq_bank";
    case "pearl_points":
      return "pearl_points";
    case "guidelines":
      return "guidelines";
    case "ospe_material":
      return "ospe_material";
    case "ospe":
      return "ospe_material";
    case "ospe_lectures":
      return "ospe_lectures";
    case "books":
      return "books";
    case "notes":
      return "notes";
    case "lectures":
      return "lectures";
    case "test":
    case "past_papers":
    case "flashcards":
      return null;
    default:
      return null;
  }
}

/**
 * Compatibility helper for legacy name → product_key resolution.
 * Production tree mapping uses RPC `product_key` only — do not call this
 * for live enrolled-year trees.
 */
export function productKeyForSubjectName(
  name: string,
  yearNumber: number
): BlockProductKey | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const byName = BLOCK_PRODUCT_DEFS.find(
    (b) => b.name.toLowerCase() === lower || b.key === lower
  );
  if (byName) return byName.key;

  const blockMatch = /^block\s*[-_]?\s*(\d{1,2})$/i.exec(trimmed);
  if (blockMatch) {
    const key = `block-${Number(blockMatch[1])}`;
    if (isBlockProductKey(key)) return key;
  }

  // No year-default invent — callers must handle null.
  void yearNumber;
  return null;
}
