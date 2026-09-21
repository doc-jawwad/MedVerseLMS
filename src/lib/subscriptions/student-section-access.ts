import type { IconKey, NavItem } from "@/components/mobile-nav";
import {
  CLASS_DISPLAY_BY_YEAR_NUMBER,
  PROF_SESSION_LABEL,
  ACADEMIC_BASE_PATH,
  blocksForYearNumber,
  classDisplayName,
  profSessionHref,
  yearHref,
} from "../academic-tree/index.ts";

/**
 * Paid LMS sections for free / expired / pending students.
 * Academic year → Block → category navigation stays open; content RPCs
 * remain the entitlement boundary. Prof. Session is section-locked.
 */
export const PAID_LMS_SECTION_HREFS = [
  "/academic/prof-session",
  "/library",
  "/mcq-bank",
  "/pearl-points",
  "/guidelines",
  "/ospe-material",
  "/ospe-lectures",
  "/books",
  "/notes",
  "/lectures",
  "/materials",
  "/practice",
  // /performance removed — merged into Dashboard; route redirects to /dashboard.
] as const;

export type PaidLmsSectionHref = (typeof PAID_LMS_SECTION_HREFS)[number];

export function studentHasPaidLmsSections(hasLiveAccess: boolean): boolean {
  return Boolean(hasLiveAccess);
}

export function isPaidLmsSectionPath(pathname: string): boolean {
  // Unified academic tree (except Prof. Session) is navigable for free students.
  if (pathname === ACADEMIC_BASE_PATH || pathname.startsWith(`${ACADEMIC_BASE_PATH}/`)) {
    if (
      pathname === `${ACADEMIC_BASE_PATH}/prof-session` ||
      pathname.startsWith(`${ACADEMIC_BASE_PATH}/prof-session/`)
    ) {
      return true;
    }
    return false;
  }
  // Legacy Resources tree aliases stay navigable (redirect targets).
  if (pathname === "/resources" || pathname.startsWith("/resources/")) {
    if (
      pathname === "/resources/prof-session" ||
      pathname.startsWith("/resources/prof-session/")
    ) {
      return true;
    }
    return false;
  }
  if (
    pathname === "/practice/ospe" ||
    pathname.startsWith("/practice/ospe/")
  ) {
    return false;
  }
  return PAID_LMS_SECTION_HREFS.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
}

export type StudentEnrollmentNav = {
  year_number: number;
  year_name: string;
};

/**
 * Class-first student shell nav — all years visible to free and paid.
 * Prof. Session is visible but locked without a live subscription.
 * Legacy flat hubs stay routable but are not listed in global nav.
 */
export function buildStudentShellNav(
  hasLiveAccess: boolean,
  _enrollment?: StudentEnrollmentNav
): {
  items: NavItem[];
  bottomItems: NavItem[];
} {
  const paid = studentHasPaidLmsSections(hasLiveAccess);
  const profHref = profSessionHref();

  const yearItems: NavItem[] = [1, 2, 3, 4, 5].map((yearNumber) => {
    const label =
      CLASS_DISPLAY_BY_YEAR_NUMBER[yearNumber] ??
      classDisplayName(yearNumber);
    return {
      href: yearHref(yearNumber),
      label,
      icon: "classLibrary" as IconKey,
      locked: false,
      children: blocksForYearNumber(yearNumber).map((block) => ({
        href: `${ACADEMIC_BASE_PATH}/${block.key}`,
        label: block.name,
        icon: "classLibrary" as IconKey,
        locked: false,
      })),
    };
  });

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", locked: false },
    ...yearItems,
    {
      href: profHref,
      label: PROF_SESSION_LABEL,
      icon: "tests",
      locked: !paid,
    },
    { href: "/tests", label: "Tests", icon: "tests", locked: false },
    {
      href: "/practice/ospe",
      label: "OSPE Practice",
      icon: "ospeMaterial",
      locked: false,
    },
    // /performance removed from nav — analytics merged into Dashboard.
    { href: "/contact", label: "Contact Us", icon: "contact", locked: false },
    {
      href: "/career-counselling",
      label: "Career Counselling Series",
      icon: "career",
      locked: false,
    },
    {
      href: "/imd-stepwise",
      label: "Get iMD & StepWise MD Subscription",
      icon: "imd",
      locked: false,
    },
    {
      href: "/subscription",
      label: "My Subscription",
      icon: "subscription",
      locked: false,
    },
    { href: "/profile", label: "My Account", icon: "account", locked: false },
  ];

  const bottomHrefs = paid
    ? ["/dashboard", "/tests", ACADEMIC_BASE_PATH, profHref]
    : ["/dashboard", "/tests", ACADEMIC_BASE_PATH, "/contact"];

  const academicBottom: NavItem = {
    href: ACADEMIC_BASE_PATH,
    label: "Academic",
    icon: "classLibrary",
    locked: false,
  };

  const byHref = new Map(items.map((i) => [i.href, i]));
  byHref.set(ACADEMIC_BASE_PATH, academicBottom);

  const bottomItems = bottomHrefs
    .map((href) => byHref.get(href))
    .filter((i): i is NavItem => Boolean(i))
    .map((item) => ({ ...item, children: undefined }));

  return { items, bottomItems };
}
