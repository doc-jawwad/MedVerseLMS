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
  blocksForYearNumber,
  classDisplayName,
  isBlockProductKey,
} from "./product-structure.ts";

/**
 * Map Data Spine `get_academic_tree` jsonb into the AcademicTree UI model.
 * Never attaches Drive URLs, stems, or correct_key.
 *
 * Compatibility: live RPC may still return older category ids (test, ospe,
 * past_papers, flashcards). Those are remapped or ignored as block categories.
 * Prof. Session days come from RPC only when present — otherwise empty.
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
    const mapped = mapRpcSubject(subjectRaw, yearNumber);
    if (mapped) mappedByKey.set(mapped.product_key, mapped);
  }

  const subjects: AcademicTreeSubject[] = blocksForYearNumber(yearNumber).map(
    (def) => {
      const existing = mappedByKey.get(def.key);
      if (existing) {
        return {
          ...existing,
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
    .map((d) => mapRpcFolder(d))
    .filter((f): f is AcademicTreeFolder => Boolean(f));
  return {
    locked: row.locked != null ? Boolean(row.locked) : libraryLocked,
    days,
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

function mapRpcSubject(
  raw: unknown,
  yearNumber: number
): AcademicTreeSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subjectId =
    typeof row.subject_id === "string" ? row.subject_id : null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!subjectId || !name) return null;

  const categoriesRaw = Array.isArray(row.categories) ? row.categories : [];
  const categories: AcademicTreeCategory[] = [];
  for (const catRaw of categoriesRaw) {
    const cat = mapRpcCategory(catRaw);
    if (cat) categories.push(cat);
  }

  return {
    subject_id: subjectId,
    product_key: productKeyForSubjectName(name, yearNumber),
    name,
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

export function productKeyForSubjectName(
  name: string,
  yearNumber: number
): BlockProductKey {
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

  return blocksForYearNumber(yearNumber)[0]?.key ?? "block-1";
}
