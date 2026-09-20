import type {
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
 * Structural scaffolding until `get_academic_tree` ships.
 * Shows the frozen Class → Block → Category → Day tree with lock flags.
 * Does not invent a second content store or paid payloads.
 *
 * Resources: same tree as Library; navigation is visible. Content leaves stay
 * empty until Data Spine returns Admin-unlocked / free / granted nodes.
 * Library without live subscription: nodes marked locked (shell also gates).
 */
export function buildStructuralAcademicTree(
  input: GetAcademicTreeInput
): AcademicTree {
  const yearName = classDisplayName(input.year_number, input.year_name);
  const libraryLocked =
    input.surface === "library" && !input.has_live_subscription;
  const libraryOpen =
    input.surface === "library" && input.has_live_subscription;

  const subjects: AcademicTreeSubject[] = blocksForYearNumber(
    input.year_number
  ).map((block) => {
    const categories: AcademicTreeCategory[] = BLOCK_CATEGORIES.map((cat) => {
      const folders: AcademicTreeFolder[] =
        cat.id === "test"
          ? buildDefaultTestDays({
              subjectKey: block.key,
              locked: libraryLocked,
            })
          : [];

      return {
        id: cat.id,
        name: cat.name,
        locked: libraryLocked,
        placeholder: cat.placeholder,
        folders,
      };
    });

    return {
      subject_id: `product:${block.key}`,
      product_key: block.key,
      name: block.name,
      locked: libraryLocked,
      categories,
    };
  });

  void libraryOpen;

  return {
    surface: input.surface,
    year_id: input.year_id,
    year_number: input.year_number,
    year_name: yearName,
    subjects,
    from_adapter: true,
  };
}

function buildDefaultTestDays(args: {
  subjectKey: string;
  locked: boolean;
}): AcademicTreeFolder[] {
  // Structural Day 1–3 scaffolding so Test IA is navigable before Data Spine
  // returns real day folders. Empty item lists — no invented content.
  return [1, 2, 3].map((n) => {
    const slug = `day-${n}`;
    const dayId = `product:${args.subjectKey}:test:${slug}`;
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
  category: AcademicTreeCategory,
  daySlug: string
): AcademicTreeFolder | null {
  return (
    category.folders.find((f) => f.is_day && f.slug === daySlug) ?? null
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
