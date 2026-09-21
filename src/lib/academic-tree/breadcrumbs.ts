import type { AcademicTreeSurface } from "./types.ts";
import { PROF_SESSION_LABEL } from "./product-structure.ts";
import {
  ACADEMIC_BASE_PATH,
  blockHref,
  categoryHref,
  dayHref,
  daySlotHref,
  folderHref,
  profSessionHref,
  searchHref,
  yearHref,
} from "./paths.ts";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

export function buildAcademicBreadcrumbs(args: {
  /** Ignored for URLs — academic tree is unified under `/academic`. */
  surface?: AcademicTreeSurface;
  yearName: string;
  yearNumber?: number;
  blockName?: string;
  blockSlug?: string;
  categoryName?: string;
  categorySlug?: string;
  folderName?: string;
  folderSlug?: string;
  /** When true, day crumbs hang under Prof. Session (not under a Block). */
  profSession?: boolean;
  dayName?: string;
  daySlug?: string;
  slotName?: string;
  slotSlug?: string;
  searchQuery?: string;
}): BreadcrumbCrumb[] {
  const crumbs: BreadcrumbCrumb[] = [
    {
      label: "Academic",
      href: ACADEMIC_BASE_PATH,
    },
  ];

  if (args.searchQuery != null) {
    crumbs.push({
      label: args.searchQuery ? `Search: ${args.searchQuery}` : "Search",
      href: searchHref(args.searchQuery),
    });
    return crumbs;
  }

  if (args.profSession || (args.dayName && args.daySlug && !args.blockSlug)) {
    crumbs.push({
      label: PROF_SESSION_LABEL,
      href: profSessionHref(),
    });

    if (args.dayName && args.daySlug) {
      crumbs.push({
        label: args.dayName,
        href: dayHref(args.daySlug),
      });
      if (args.slotName && args.slotSlug) {
        crumbs.push({
          label: args.slotName,
          href: daySlotHref(args.daySlug, args.slotSlug),
        });
      }
    }
    return finalize(crumbs);
  }

  if (args.yearName && args.yearNumber != null) {
    crumbs.push({
      label: args.yearName,
      href: yearHref(args.yearNumber),
    });
  } else if (args.yearName && !args.blockSlug) {
    crumbs.push({ label: args.yearName });
  }

  if (args.blockName && args.blockSlug) {
    crumbs.push({
      label: args.blockName,
      href: blockHref(args.blockSlug),
    });
  }

  if (args.categoryName && args.categorySlug && args.blockSlug) {
    crumbs.push({
      label: args.categoryName,
      href: categoryHref(args.blockSlug, args.categorySlug),
    });
  }

  if (
    args.folderName &&
    args.folderSlug &&
    args.blockSlug &&
    args.categorySlug
  ) {
    crumbs.push({
      label: args.folderName,
      href: folderHref(args.blockSlug, args.categorySlug, args.folderSlug),
    });
  }

  return finalize(crumbs);
}

function finalize(crumbs: BreadcrumbCrumb[]): BreadcrumbCrumb[] {
  if (crumbs.length === 0) return crumbs;
  const last = crumbs[crumbs.length - 1]!;
  return [...crumbs.slice(0, -1), { label: last.label }];
}

export {
  ACADEMIC_BASE_PATH,
  blockHref,
  categoryHref,
  dayHref,
  daySlotHref,
  folderHref,
  profSessionHref,
  searchHref,
  surfaceBasePath,
  surfaceLabel,
  yearHref,
} from "./paths.ts";
