import type { IconKey, NavItem } from "@/components/mobile-nav";
import { LIBRARY_LIST } from "../library/types.ts";

/**
 * Full-library hubs locked for free / expired / pending students.
 * Tests (history) and Free Resources stay unlocked. Content RPCs remain
 * the authorization boundary for free/granted items.
 */
export const PAID_LMS_SECTION_HREFS = [
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
  return PAID_LMS_SECTION_HREFS.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
}

type NavDef = {
  href: string;
  label: string;
  icon: IconKey;
  /** When true, item is locked unless the student has paid LMS sections. */
  requiresPaidSections?: boolean;
};

const STUDENT_NAV_DEFS: NavDef[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/tests", label: "Tests", icon: "tests" },
  { href: "/free-resources", label: "Free Resources", icon: "freeResources" },
  ...LIBRARY_LIST.map((lib) => ({
    href: lib.href,
    label: lib.label,
    icon: lib.icon,
    requiresPaidSections: true as const,
  })),
  {
    href: "/performance",
    label: "Performance",
    icon: "performance",
    requiresPaidSections: true,
  },
  { href: "/contact", label: "Contact Us", icon: "contact" },
  { href: "/career-counselling", label: "Career Counselling Series", icon: "career" },
  {
    href: "/imd-stepwise",
    label: "Get iMD & StepWise MD Subscription",
    icon: "imd",
  },
  { href: "/subscription", label: "My Subscription", icon: "subscription" },
  { href: "/profile", label: "My Account", icon: "account" },
];

export function buildStudentShellNav(hasLiveAccess: boolean): {
  items: NavItem[];
  bottomItems: NavItem[];
} {
  const paid = studentHasPaidLmsSections(hasLiveAccess);
  const items: NavItem[] = STUDENT_NAV_DEFS.map((def) => ({
    href: def.href,
    label: def.label,
    icon: def.icon,
    locked: Boolean(def.requiresPaidSections) && !paid,
  }));

  const bottomHrefs = paid
    ? ["/dashboard", "/tests", "/mcq-bank", "/pearl-points"]
    : ["/dashboard", "/tests", "/free-resources", "/contact"];

  const byHref = new Map(items.map((i) => [i.href, i]));
  const bottomItems = bottomHrefs
    .map((href) => byHref.get(href))
    .filter((i): i is NavItem => Boolean(i));

  return { items, bottomItems };
}
