import type { AcademicTreeSurface } from "./types.ts";
import {
  PROF_SESSION_SLUG,
  findCategoryById,
  findCategoryBySlug,
} from "./product-structure.ts";

/** Primary student academic tree base (not Resources/Library dual surfaces). */
export const ACADEMIC_BASE_PATH = "/academic";

/**
 * @deprecated Surface no longer selects a URL prefix — always `/academic`.
 * Kept so Data Spine RPC `resources|library` callers still compile.
 */
export function surfaceBasePath(_surface?: AcademicTreeSurface): string {
  return ACADEMIC_BASE_PATH;
}

export function surfaceLabel(_surface?: AcademicTreeSurface): string {
  return "Academic";
}

export function categorySlugFromId(id: string): string {
  return findCategoryById(id)?.slug ?? id.replaceAll("_", "-");
}

export function parseCategorySlug(slug: string) {
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

export function yearHref(yearNumber: number): string {
  return `${ACADEMIC_BASE_PATH}/year/${yearNumber}`;
}

export function classHref(_surface?: AcademicTreeSurface): string {
  return ACADEMIC_BASE_PATH;
}

export function blockHref(
  _surface: AcademicTreeSurface | undefined,
  blockSlug: string
): string;
export function blockHref(blockSlug: string): string;
export function blockHref(
  surfaceOrBlock: AcademicTreeSurface | string | undefined,
  blockSlug?: string
): string {
  const slug =
    typeof surfaceOrBlock === "string" && blockSlug === undefined
      ? surfaceOrBlock
      : blockSlug!;
  return `${ACADEMIC_BASE_PATH}/${encodeURIComponent(slug)}`;
}

export function categoryHref(
  _surface: AcademicTreeSurface | undefined,
  blockSlug: string,
  categorySlug: string
): string;
export function categoryHref(blockSlug: string, categorySlug: string): string;
export function categoryHref(
  a: AcademicTreeSurface | string | undefined,
  b: string,
  c?: string
): string {
  if (c !== undefined) {
    return `${blockHref(undefined, b)}/${encodeURIComponent(c)}`;
  }
  return `${blockHref(undefined, a as string)}/${encodeURIComponent(b)}`;
}

export function folderHref(
  _surface: AcademicTreeSurface | undefined,
  blockSlug: string,
  categorySlug: string,
  folderSlug: string
): string;
export function folderHref(
  blockSlug: string,
  categorySlug: string,
  folderSlug: string
): string;
export function folderHref(
  a: AcademicTreeSurface | string | undefined,
  b: string,
  c: string,
  d?: string
): string {
  if (d !== undefined) {
    return `${categoryHref(undefined, b, c)}/f/${encodeURIComponent(d)}`;
  }
  return `${categoryHref(undefined, a as string, b)}/f/${encodeURIComponent(c)}`;
}

export function profSessionHref(_surface?: AcademicTreeSurface): string {
  return `${ACADEMIC_BASE_PATH}/${PROF_SESSION_SLUG}`;
}

export function dayHref(
  _surface: AcademicTreeSurface | undefined,
  daySlug: string
): string;
export function dayHref(daySlug: string): string;
export function dayHref(
  surfaceOrDay: AcademicTreeSurface | string | undefined,
  daySlug?: string
): string {
  const slug =
    typeof surfaceOrDay === "string" && daySlug === undefined
      ? surfaceOrDay
      : daySlug!;
  return `${profSessionHref()}/${encodeURIComponent(slug)}`;
}

export function daySlotHref(
  _surface: AcademicTreeSurface | undefined,
  daySlug: string,
  slotSlug: string
): string;
export function daySlotHref(daySlug: string, slotSlug: string): string;
export function daySlotHref(
  a: AcademicTreeSurface | string | undefined,
  b: string,
  c?: string
): string {
  if (c !== undefined) {
    return `${dayHref(undefined, b)}/${encodeURIComponent(c)}`;
  }
  return `${dayHref(undefined, a as string)}/${encodeURIComponent(b)}`;
}

export function searchHref(
  _surface: AcademicTreeSurface | undefined,
  query: string
): string;
export function searchHref(query: string): string;
export function searchHref(
  surfaceOrQuery: AcademicTreeSurface | string | undefined,
  query?: string
): string {
  const q =
    typeof surfaceOrQuery === "string" && query === undefined
      ? surfaceOrQuery
      : (query ?? "");
  const trimmed = q.trim();
  const base = `${ACADEMIC_BASE_PATH}/search`;
  return trimmed ? `${base}?q=${encodeURIComponent(trimmed)}` : base;
}

/** True when pathname is under Prof. Session (paid section). */
export function isProfSessionPath(pathname: string): boolean {
  const base = profSessionHref();
  return pathname === base || pathname.startsWith(`${base}/`);
}
