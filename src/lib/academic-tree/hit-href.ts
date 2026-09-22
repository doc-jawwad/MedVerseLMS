import type { AcademicSearchHit, AcademicTreeSurface } from "./types.ts";
import {
  ALL_BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  PROF_SESSION_CATEGORIES,
  PROF_SESSION_LABEL,
  isBlockProductKey,
} from "./product-structure.ts";
import {
  ACADEMIC_BASE_PATH,
  blockHref,
  categoryHref,
  dayHref,
  profSessionCategoryHref,
  profSessionHref,
  profSessionSubjectHref,
} from "./paths.ts";

/**
 * Map search hits onto the unified `/academic` tree.
 * Prefer authoritative `product_key` / day id when present on the hit.
 */
export function hrefForAcademicSearchHit(
  hit: Pick<AcademicSearchHit, "kind" | "name" | "path_labels" | "id"> & {
    product_key?: string | null;
  },
  _surface?: AcademicTreeSurface
): string {
  const home = ACADEMIC_BASE_PATH;
  const labels = hit.path_labels ?? [];

  if (hit.kind === "class") return home;
  if (hit.kind === "prof_session") return profSessionHref();

  const productKey =
    hit.product_key && isBlockProductKey(hit.product_key)
      ? hit.product_key
      : null;
  const blockSlug = productKey ?? blockSlugFromLabels(labels);
  const categorySlug = categorySlugFromLabels(labels);
  const underProf = labels.some(
    (l) => normalizeKey(l) === normalizeKey(PROF_SESSION_LABEL)
  );
  const psCategorySlug = psCategorySlugFromLabels(labels);

  if (hit.kind === "day") {
    const key = productKey ?? blockSlugFromLabels(labels);
    if (hit.id && !hit.id.includes(":") && key) {
      return dayHref(key, hit.id);
    }
    const daySlug = daySlugFromName(hit.name);
    if (underProf && key) {
      return daySlug ? dayHref(key, daySlug) : profSessionSubjectHref(key);
    }
    if (underProf) return profSessionHref();
    return key ? blockHref(key) : home;
  }

  if (hit.kind === "block") {
    const slug =
      productKey ??
      blockSlugFromName(hit.name) ??
      blockSlug ??
      productKeyFromName(hit.name);
    if (underProf && slug) return profSessionSubjectHref(slug);
    return slug ? blockHref(slug) : home;
  }

  if (hit.kind === "category") {
    if (underProf) {
      const key = productKey ?? blockSlugFromLabels(labels);
      const cat =
        psCategorySlug ??
        psCategorySlugFromName(hit.name) ??
        categorySlugFromName(hit.name);
      if (key && cat) return profSessionCategoryHref(key, cat);
      if (key) return profSessionSubjectHref(key);
      return profSessionHref();
    }
    const cat =
      categorySlugFromName(hit.name) ??
      categorySlug ??
      categorySlugFromLabels(labels);
    const block = blockSlug ?? blockSlugFromLabels(labels);
    if (block && cat) return categoryHref(block, cat);
    return home;
  }

  if (hit.kind === "folder") {
    if (underProf) {
      const key = productKey ?? blockSlugFromLabels(labels);
      if (key && psCategorySlug) {
        return profSessionCategoryHref(key, psCategorySlug);
      }
      if (key) return profSessionSubjectHref(key);
      return profSessionHref();
    }
    if (blockSlug && categorySlug) {
      return categoryHref(blockSlug, categorySlug);
    }
    if (blockSlug) return blockHref(blockSlug);
    return home;
  }

  return home;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function productKeyFromName(name: string): string | null {
  const key = normalizeKey(name);
  const byName = BLOCK_PRODUCT_DEFS.find(
    (b) => normalizeKey(b.name) === key || normalizeKey(b.key) === key
  );
  return byName?.key ?? null;
}

function blockSlugFromName(name: string): string | null {
  return productKeyFromName(name);
}

function blockSlugFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const slug = blockSlugFromName(label);
    if (slug) return slug;
  }
  return null;
}

function categorySlugFromName(name: string): string | null {
  const key = normalizeKey(name);
  const found = ALL_BLOCK_CATEGORIES.find(
    (c) => normalizeKey(c.name) === key || normalizeKey(c.slug) === key
  );
  return found?.slug ?? null;
}

function categorySlugFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const slug = categorySlugFromName(label);
    if (slug) return slug;
  }
  return null;
}

function psCategorySlugFromName(name: string): string | null {
  const key = normalizeKey(name);
  const found = PROF_SESSION_CATEGORIES.find(
    (c) => normalizeKey(c.name) === key || normalizeKey(c.slug) === key
  );
  return found?.slug ?? null;
}

function psCategorySlugFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const slug = psCategorySlugFromName(label);
    if (slug) return slug;
  }
  return null;
}

function daySlugFromName(name: string): string | null {
  const match = /^day\s*[-_]?\s*(\d+)$/i.exec(name.trim());
  if (match) return `day-${match[1]}`;
  if (/^day-\d+$/i.test(name.trim())) return name.trim().toLowerCase();
  return null;
}
