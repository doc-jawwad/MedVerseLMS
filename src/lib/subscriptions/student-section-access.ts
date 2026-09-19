import type { IconKey, NavItem } from "@/components/mobile-nav";

/**
 * Paid LMS section hubs (Materials / Practice / Tests / Performance).
 * Live subscription (incl. grace / complimentary live plan) unlocks these.
 * Pending applications do not. Content entitlement for free/granted items
 * remains a separate layer (Free Resources + content RPCs).
 */
export const PAID_LMS_SECTION_HREFS = [
  "/materials",
  "/practice",
  "/tests",
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
  { href: "/free-resources", label: "Free Resources", icon: "freeResources" },
  {
    href: "/materials",
    label: "Study Materials",
    icon: "materials",
    requiresPaidSections: true,
  },
  {
    href: "/practice",
    label: "Practice MCQs",
    icon: "practice",
    requiresPaidSections: true,
  },
  {
    href: "/tests",
    label: "Tests",
    icon: "tests",
    requiresPaidSections: true,
  },
  {
    href: "/performance",
    label: "Performance",
    icon: "performance",
    requiresPaidSections: true,
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

  // Free: Dashboard, Free Resources, Subscription, Account.
  // Subscribed: Dashboard, Practice, Tests, Performance (full catalog in More).
  const bottomHrefs = paid
    ? ["/dashboard", "/practice", "/tests", "/performance"]
    : ["/dashboard", "/free-resources", "/subscription", "/profile"];

  const byHref = new Map(items.map((i) => [i.href, i]));
  const bottomItems = bottomHrefs
    .map((href) => byHref.get(href))
    .filter((i): i is NavItem => Boolean(i));

  return { items, bottomItems };
}
