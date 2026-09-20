import type { AcademicTreeSurface, BlockCategoryId } from "./types.ts";
import {
  PROF_SESSION_SLUG,
  findCategoryById,
  findCategoryBySlug,
} from "./product-structure.ts";

export function surfaceBasePath(surface: AcademicTreeSurface): string {
  return surface === "resources" ? "/resources" : "/library";
}

export function surfaceLabel(surface: AcademicTreeSurface): string {
  return surface === "resources" ? "Resources" : "Library";
}

export function categorySlugFromId(id: BlockCategoryId | string): string {
  return findCategoryById(id)?.slug ?? id.replaceAll("_", "-");
}

export function parseCategorySlug(slug: string): BlockCategoryId | null {
  return findCategoryBySlug(slug)?.id ?? null;
}

export function isKnownDaySlotSlug(slug: string): boolean {
  return (
    slug === "syllabus" ||
    slug === "guidelines" ||
    slug === "one-liners" ||
    slug === "practice-mcqs" ||
    slug === "test-mcq"
  );
}

export function blockHref(
  surface: AcademicTreeSurface,
  blockSlug: string
): string {
  return `${surfaceBasePath(surface)}/${encodeURIComponent(blockSlug)}`;
}

export function categoryHref(
  surface: AcademicTreeSurface,
  blockSlug: string,
  categorySlug: string
): string {
  return `${blockHref(surface, blockSlug)}/${encodeURIComponent(categorySlug)}`;
}

export function folderHref(
  surface: AcademicTreeSurface,
  blockSlug: string,
  categorySlug: string,
  folderSlug: string
): string {
  return `${categoryHref(surface, blockSlug, categorySlug)}/f/${encodeURIComponent(folderSlug)}`;
}

export function profSessionHref(surface: AcademicTreeSurface): string {
  return `${surfaceBasePath(surface)}/${PROF_SESSION_SLUG}`;
}

export function dayHref(surface: AcademicTreeSurface, daySlug: string): string {
  return `${profSessionHref(surface)}/${encodeURIComponent(daySlug)}`;
}

export function daySlotHref(
  surface: AcademicTreeSurface,
  daySlug: string,
  slotSlug: string
): string {
  return `${dayHref(surface, daySlug)}/${encodeURIComponent(slotSlug)}`;
}

export function searchHref(
  surface: AcademicTreeSurface,
  query: string
): string {
  const q = query.trim();
  const base = `${surfaceBasePath(surface)}/search`;
  return q ? `${base}?q=${encodeURIComponent(q)}` : base;
}

export function classHref(surface: AcademicTreeSurface): string {
  return surfaceBasePath(surface);
}
