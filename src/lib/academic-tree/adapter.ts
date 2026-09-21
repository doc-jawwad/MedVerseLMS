import type {
  AcademicProfSession,
  AcademicTree,
  AcademicTreeAdapter,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeSubject,
  GetAcademicTreeInput,
} from "./types.ts";
import {
  BLOCK_CATEGORIES,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  classDisplayName,
} from "./product-structure.ts";
import { searchAcademicTreeNames } from "./search.ts";

/**
 * Structural product chrome for non-enrolled years / offline fallback.
 * Blocks come from product_key defs. Prof. Session days are empty —
 * never invent Day 1–3 (Admin-created days only via Data Spine RPC).
 */
export function buildStructuralAcademicTree(
  input: GetAcademicTreeInput
): AcademicTree {
  const yearName = classDisplayName(input.year_number, input.year_name);
  const libraryLocked =
    input.surface === "library" && !input.has_live_subscription;

  const subjects: AcademicTreeSubject[] = blocksForYearNumber(
    input.year_number
  ).map((block) => {
    const categories: AcademicTreeCategory[] = BLOCK_CATEGORIES.map((cat) => ({
      id: cat.id,
      name: cat.name,
      locked: libraryLocked,
      placeholder: cat.placeholder,
      folders: [],
    }));

    return {
      subject_id: `product:${block.key}`,
      product_key: block.key,
      name: block.name,
      locked: libraryLocked,
      categories,
    };
  });

  const prof_session: AcademicProfSession = {
    // Free chrome: locked; subscribed browsing another year: unlocked empty.
    locked: !input.has_live_subscription,
    days: [],
  };

  return {
    surface: input.surface,
    year_id: input.year_id,
    year_number: input.year_number,
    year_name: yearName,
    subjects,
    prof_session,
    from_adapter: true,
  };
}

/**
 * @deprecated Fake Day 1–3 scaffolding — kept only for unit tests that
 * assert historical shape. Production paths must not call this.
 */
export function buildDefaultProfSessionDays(args: {
  locked: boolean;
}): AcademicTreeFolder[] {
  return [1, 2, 3].map((n) => {
    const slug = `day-${n}`;
    const dayId = `product:prof-session:${slug}`;
    const slotChildren: AcademicTreeFolder[] = TEST_DAY_SLOTS.map((slot) => ({
      id: `${dayId}:${slot.id}`,
      slug: slot.slug,
      name: slot.name,
      locked: args.locked,
      parent_id: dayId,
      children: [],
      items: [],
      day_slot: slot.id,
    }));

    return {
      id: dayId,
      slug,
      name: `Day ${n}`,
      locked: args.locked,
      parent_id: null,
      children: slotChildren,
      items: [],
      is_day: true,
    };
  });
}

export const structuralAcademicTreeAdapter: AcademicTreeAdapter = {
  async getAcademicTree(input) {
    return buildStructuralAcademicTree(input);
  },
  searchAcademicTree(input) {
    return searchAcademicTreeNames(input);
  },
};

export function findSubjectInTree(
  tree: AcademicTree,
  productKey: string
): AcademicTreeSubject | null {
  return tree.subjects.find((s) => s.product_key === productKey) ?? null;
}

export function findCategoryInSubject(
  subject: AcademicTreeSubject,
  categoryId: string
): AcademicTreeCategory | null {
  return subject.categories.find((c) => c.id === categoryId) ?? null;
}

export function findDayFolder(
  days: AcademicTreeFolder[],
  daySlug: string
): AcademicTreeFolder | null {
  return (
    days.find((f) => f.is_day && (f.slug === daySlug || f.id === daySlug)) ??
    null
  );
}

export function findFolderBySlug(
  category: AcademicTreeCategory,
  folderSlug: string
): AcademicTreeFolder | null {
  const stack = [...category.folders];
  while (stack.length) {
    const folder = stack.pop()!;
    if (folder.slug === folderSlug) return folder;
    stack.push(...folder.children);
  }
  return null;
}
