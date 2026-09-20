import type { IconKey, NavItem } from "@/components/mobile-nav";
import {
  PROF_SESSION_LABEL,
  PROF_SESSION_SLUG,
  blocksForYearNumber,
  classDisplayName,
} from "../academic-tree/index.ts";

/**
 * Full-library hubs locked for free / expired / pending students.
 * Tests (history) and Resources stay unlocked. Content RPCs remain
 * the authorization boundary for free/granted items.
 */
export const PAID_LMS_SECTION_HREFS = [
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
  "/performance",
] as const;

export type PaidLmsSectionHref = (typeof PAID_LMS_SECTION_HREFS)[number];

export function studentHasPaidLmsSections(hasLiveAccess: boolean): boolean {
  return Boolean(hasLiveAccess);
}

export function isPaidLmsSectionPath(pathname: string): boolean {
  if (pathname === "/resources" || pathname.startsWith("/resources/")) {
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
 * Class-first student shell nav.
 * Free: Resources surface. Paid: Library surface + Prof. Session.
 * Legacy flat hubs stay routable but are not listed in global nav.
 */
export function buildStudentShellNav(
  hasLiveAccess: boolean,
  enrollment?: StudentEnrollmentNav
): {
  items: NavItem[];
  bottomItems: NavItem[];
} {
  const paid = studentHasPaidLmsSections(hasLiveAccess);
  const yearNumber = enrollment?.year_number ?? 1;
  const yearName = classDisplayName(yearNumber, enrollment?.year_name);
  const classSurface = paid ? "library" : "resources";
  const classHref = `/${classSurface}`;
  const profHref = `/${classSurface}/${PROF_SESSION_SLUG}`;

  const blockChildren: NavItem[] = blocksForYearNumber(yearNumber).map(
    (block) => ({
      href: `${classHref}/${block.key}`,
      label: block.name,
      icon: "classLibrary" as IconKey,
    })
  );

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", locked: false },
    {
      href: classHref,
      label: yearName,
      icon: "classLibrary",
      locked: false,
      children: blockChildren,
    },
    {
      href: profHref,
      label: PROF_SESSION_LABEL,
      icon: "tests",
      locked: false,
    },
    { href: "/tests", label: "Tests", icon: "tests", locked: false },
    {
      href: "/practice/ospe",
      label: "OSPE Practice",
      icon: "ospeMaterial",
      locked: false,
    },
    {
      href: "/performance",
      label: "Performance",
      icon: "performance",
      locked: !paid,
    },
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
    ? ["/dashboard", "/tests", classHref, profHref]
    : ["/dashboard", "/tests", classHref, "/contact"];

  const byHref = new Map(items.map((i) => [i.href, i]));
  const bottomItems = bottomHrefs
    .map((href) => {
      const item = byHref.get(href);
      if (item) return item;
      return undefined;
    })
    .filter((i): i is NavItem => Boolean(i))
    .map((item) =>
      item.href === classHref
        ? {
            ...item,
            label: paid ? "Library" : "Resources",
            children: undefined,
          }
        : { ...item, children: undefined }
    );

  return { items, bottomItems };
}
