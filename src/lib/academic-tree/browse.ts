import "server-only";

import { notFound } from "next/navigation";
import {
  findCategoryInSubject,
  findDayFolder,
  findSubjectInTree,
} from "./adapter.ts";
import {
  findBlockProduct,
  findCategoryBySlug,
  findDaySlotBySlug,
  isBlockProductKey,
} from "./product-structure.ts";
import { getAcademicTreePageContext } from "./page-context.ts";
import { loadAcademicTree } from "./load-tree.ts";
import { requireStudent } from "@/lib/auth/require-user";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import type {
  AcademicTree,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeSubject,
  AcademicTreeSurface,
  BlockCategoryId,
  TestDaySlotId,
} from "./types.ts";

export type AcademicBrowseContext = {
  tree: AcademicTree;
  error: string | null;
  hasLiveAccess: boolean;
  year_id: string;
  year_number: number;
  year_name: string;
  /** RPC surface still used for Data Spine; URLs are always `/academic`. */
  surface: AcademicTreeSurface;
};

/**
 * Load academic browse context for the enrolled year (architecture §2d).
 * Other year URLs redirect at the page layer before calling this.
 */
export async function loadAcademicBrowseForYear(
  _yearNumber: number
): Promise<AcademicBrowseContext> {
  const { supabase, enrollment } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  const surface: AcademicTreeSurface = hasLiveAccess ? "library" : "resources";

  const { tree, error } = await loadAcademicTree({
    supabase,
    surface,
    year_id: enrollment.year_id,
    year_number: enrollment.year_number,
    year_name: enrollment.year_name,
    has_live_subscription: hasLiveAccess,
  });
  // Free students must navigate unlocked chrome; content stays RPC-gated.
  const navigable = unlockNavigationChrome(tree);
  return {
    tree: navigable,
    error,
    hasLiveAccess,
    year_id: enrollment.year_id,
    year_number: enrollment.year_number,
    year_name: enrollment.year_name,
    surface,
  };
}

/** Prefer enrolled-year context (legacy loadAcademicBrowse callers). */
export async function loadAcademicBrowse(
  _surface?: AcademicTreeSurface
): Promise<AcademicBrowseContext> {
  const ctx = await getAcademicTreePageContext(
    _surface ?? ((await getStudentHasLiveSubscription()) ? "library" : "resources")
  );
  return {
    ...ctx,
    tree: unlockNavigationChrome(ctx.tree),
    surface: ctx.tree.surface,
  };
}

/** UX: free students see the full hierarchy; locks apply to content leaves / Prof. Session. */
function unlockNavigationChrome(tree: AcademicTree): AcademicTree {
  return {
    ...tree,
    subjects: tree.subjects.map((s) => ({
      ...s,
      locked: false,
      categories: s.categories.map((c) => ({
        ...c,
        locked: false,
        folders: c.folders.map((f) => ({ ...f, locked: f.locked })),
      })),
    })),
    // Prof. Session lock is enforced at the page/nav layer for free students.
    prof_session: {
      ...tree.prof_session,
      locked: tree.prof_session.locked,
    },
  };
}

export function requireYearNumber(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) notFound();
  return n;
}

export function requireBlock(
  tree: AcademicTree,
  blockSlug: string
): AcademicTreeSubject {
  if (!isBlockProductKey(blockSlug)) notFound();
  const subject = findSubjectInTree(tree, blockSlug);
  if (subject) return subject;

  // Structural fallback when product Block missing from live tree.
  const product = findBlockProduct(blockSlug);
  if (!product || product.year_number !== tree.year_number) notFound();
  notFound();
}

export function requireCategory(
  subject: AcademicTreeSubject,
  categorySlug: string
): { category: AcademicTreeCategory; categoryId: BlockCategoryId } {
  const def = findCategoryBySlug(categorySlug);
  if (!def) notFound();
  const category = findCategoryInSubject(subject, def.id);
  if (!category) notFound();
  return { category, categoryId: def.id };
}

export function requireProfDay(
  tree: AcademicTree,
  daySlug: string
): AcademicTreeFolder {
  const day = findDayFolder(tree.prof_session.days, daySlug);
  if (!day) notFound();
  return day;
}

export function requireDaySlot(
  day: AcademicTreeFolder,
  slotSlug: string
): { slot: AcademicTreeFolder; slotId: TestDaySlotId } {
  const def = findDaySlotBySlug(slotSlug);
  if (!def) notFound();
  const slot =
    day.children.find((c) => c.day_slot === def.id || c.slug === def.slug) ??
    null;
  if (!slot) notFound();
  return { slot, slotId: def.id };
}

/** Resolve which year tree to load for a block product key. */
export function yearNumberForBlockSlug(blockSlug: string): number | null {
  const product = findBlockProduct(blockSlug);
  return product?.year_number ?? null;
}
