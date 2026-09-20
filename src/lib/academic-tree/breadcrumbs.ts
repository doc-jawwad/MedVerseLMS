import type { AcademicTreeSurface } from "./types.ts";
import {
  blockHref,
  categoryHref,
  dayHref,
  daySlotHref,
  folderHref,
  searchHref,
  surfaceBasePath,
  surfaceLabel,
} from "./paths.ts";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

export function buildAcademicBreadcrumbs(args: {
  surface: AcademicTreeSurface;
  yearName: string;
  blockName?: string;
  blockSlug?: string;
  categoryName?: string;
  categorySlug?: string;
  folderName?: string;
  folderSlug?: string;
  dayName?: string;
  daySlug?: string;
  slotName?: string;
  slotSlug?: string;
  searchQuery?: string;
}): BreadcrumbCrumb[] {
  const crumbs: BreadcrumbCrumb[] = [
    {
      label: surfaceLabel(args.surface),
      href: surfaceBasePath(args.surface),
    },
  ];

  if (args.searchQuery != null) {
    crumbs.push({
      label: args.searchQuery ? `Search: ${args.searchQuery}` : "Search",
      href: searchHref(args.surface, args.searchQuery),
    });
    return crumbs;
  }

  if (args.blockName && args.blockSlug) {
    crumbs.push({
      label: args.blockName,
      href: blockHref(args.surface, args.blockSlug),
    });
  }

  if (args.categoryName && args.categorySlug && args.blockSlug) {
    crumbs.push({
      label: args.categoryName,
      href: categoryHref(args.surface, args.blockSlug, args.categorySlug),
    });
  }

  if (args.dayName && args.daySlug && args.blockSlug) {
    crumbs.push({
      label: args.dayName,
      href: dayHref(args.surface, args.blockSlug, args.daySlug),
    });
    if (args.slotName && args.slotSlug) {
      crumbs.push({
        label: args.slotName,
        href: daySlotHref(
          args.surface,
          args.blockSlug,
          args.daySlug,
          args.slotSlug
        ),
      });
    }
    return finalize(crumbs);
  }

  if (
    args.folderName &&
    args.folderSlug &&
    args.blockSlug &&
    args.categorySlug
  ) {
    crumbs.push({
      label: args.folderName,
      href: folderHref(
        args.surface,
        args.blockSlug,
        args.categorySlug,
        args.folderSlug
      ),
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
  blockHref,
  categoryHref,
  dayHref,
  daySlotHref,
  folderHref,
  searchHref,
  surfaceBasePath,
  surfaceLabel,
} from "./paths.ts";
