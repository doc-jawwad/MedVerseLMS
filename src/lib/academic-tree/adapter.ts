import type {
  AcademicProfSession,
  AcademicProfSessionSubject,
  AcademicTree,
  AcademicTreeAdapter,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeSubject,
  GetAcademicTreeInput,
} from "./types.ts";
import {
  BLOCK_CATEGORIES,
  PROF_SESSION_CATEGORIES,
  blocksForYearNumber,
  classDisplayName,
} from "./product-structure.ts";
import { searchAcademicTreeNames } from "./search.ts";

/**
 * Structural product chrome for non-enrolled years / offline fallback.
 * Blocks come from product_key defs. Prof. Session subjects are empty days —
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

  const profSubjects: AcademicProfSessionSubject[] = input.has_live_subscription
    ? blocksForYearNumber(input.year_number).map((block) => ({
        subject_id: `product:${block.key}`,
        product_key: block.key,
        name: block.name,
        categories: PROF_SESSION_CATEGORIES.map((cat) => ({
          id: cat.id,
          name: cat.name,
          locked: false,
          folders: [],
        })),
        days: [],
      }))
    : [];

  const prof_session: AcademicProfSession = {
    locked: !input.has_live_subscription,
    subjects: profSubjects,
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

export function findProfSubjectInTree(
  tree: AcademicTree,
  productKey: string
): AcademicProfSessionSubject | null {
  return (
    tree.prof_session.subjects.find((s) => s.product_key === productKey) ??
    null
  );
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
