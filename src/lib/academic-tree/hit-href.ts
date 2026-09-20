import type { AcademicSearchHit, AcademicTreeSurface } from "./types.ts";
import {
  BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  PROF_SESSION_LABEL,
} from "./product-structure.ts";
import {
  blockHref,
  categoryHref,
  classHref,
  dayHref,
  profSessionHref,
  surfaceBasePath,
} from "./paths.ts";

/**
 * Map search hits onto class-first `/resources` + `/library` nested routes.
 */
export function hrefForAcademicSearchHit(
  hit: Pick<AcademicSearchHit, "kind" | "name" | "path_labels">,
  surface: AcademicTreeSurface
): string {
  const home = classHref(surface);
  const labels = hit.path_labels ?? [];

  if (hit.kind === "class") return home;
  if (hit.kind === "prof_session") return profSessionHref(surface);

  const blockSlug = blockSlugFromLabels(labels);
  const categorySlug = categorySlugFromLabels(labels);
  const underProf = labels.some(
    (l) => normalizeKey(l) === normalizeKey(PROF_SESSION_LABEL)
  );

  if (hit.kind === "day") {
    const daySlug = daySlugFromName(hit.name);
    if (underProf || !blockSlug) {
      return daySlug ? dayHref(surface, daySlug) : profSessionHref(surface);
    }
    return blockSlug ? blockHref(surface, blockSlug) : home;
  }

  if (hit.kind === "block") {
    const slug =
      blockSlugFromName(hit.name) ?? blockSlug ?? productKeyFromName(hit.name);
    return slug ? blockHref(surface, slug) : home;
  }

  if (hit.kind === "category") {
    const cat =
      categorySlugFromName(hit.name) ??
      categorySlug ??
      categorySlugFromLabels(labels);
    const block = blockSlug ?? blockSlugFromLabels(labels);
    if (block && cat) return categoryHref(surface, block, cat);
    return home;
  }

  if (hit.kind === "folder") {
    if (underProf) return profSessionHref(surface);
    if (blockSlug && categorySlug) {
      return categoryHref(surface, blockSlug, categorySlug);
    }
    if (blockSlug) return blockHref(surface, blockSlug);
    return home;
  }

  return surfaceBasePath(surface);
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
  const found = BLOCK_CATEGORIES.find(
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

function daySlugFromName(name: string): string | null {
  const match = /^day\s*[-_]?\s*(\d+)$/i.exec(name.trim());
  if (match) return `day-${match[1]}`;
  if (/^day-\d+$/i.test(name.trim())) return name.trim().toLowerCase();
  return null;
}
