import type { BlockCategoryId, BlockProductKey, TestDaySlotId } from "./types.ts";

/** Canonical class display names (SPEC FREEZE). */
export const CLASS_DISPLAY_BY_YEAR_NUMBER: Record<number, string> = {
  1: "1st Year MBBS",
  2: "2nd Year MBBS",
  3: "3rd Year MBBS",
  4: "4th Year MBBS",
  5: "Final Year MBBS",
};

export function classDisplayName(
  yearNumber: number,
  fallbackName?: string | null
): string {
  return (
    CLASS_DISPLAY_BY_YEAR_NUMBER[yearNumber] ??
    fallbackName?.trim() ??
    `Year ${yearNumber}`
  );
}

export type BlockProductDef = {
  key: BlockProductKey;
  name: string;
  year_number: number;
};

export const BLOCK_PRODUCT_DEFS: readonly BlockProductDef[] = [
  { key: "block-1", name: "Block 1", year_number: 1 },
  { key: "block-2", name: "Block 2", year_number: 1 },
  { key: "block-3", name: "Block 3", year_number: 1 },
  { key: "block-4", name: "Block 4", year_number: 2 },
  { key: "block-5", name: "Block 5", year_number: 2 },
  { key: "block-6", name: "Block 6", year_number: 2 },
  { key: "block-7", name: "Block 7", year_number: 3 },
  { key: "block-8", name: "Block 8", year_number: 3 },
  { key: "block-9", name: "Block 9", year_number: 3 },
  { key: "block-10", name: "Block 10", year_number: 4 },
  { key: "block-11", name: "Block 11", year_number: 4 },
  { key: "block-12", name: "Block 12", year_number: 4 },
  { key: "medicine", name: "Medicine", year_number: 5 },
  { key: "surgery", name: "Surgery", year_number: 5 },
  { key: "gynecology", name: "Gynecology", year_number: 5 },
  { key: "pediatrics", name: "Pediatrics", year_number: 5 },
] as const;

export function blocksForYearNumber(yearNumber: number): BlockProductDef[] {
  return BLOCK_PRODUCT_DEFS.filter((b) => b.year_number === yearNumber);
}

export function findBlockProduct(
  key: string
): BlockProductDef | null {
  return BLOCK_PRODUCT_DEFS.find((b) => b.key === key) ?? null;
}

export function isBlockProductKey(value: string): value is BlockProductKey {
  return BLOCK_PRODUCT_DEFS.some((b) => b.key === value);
}

export type BlockCategoryDef = {
  id: BlockCategoryId;
  name: string;
  slug: string;
  description: string;
  placeholder?: boolean;
};

export const BLOCK_CATEGORIES: readonly BlockCategoryDef[] = [
  {
    id: "test",
    name: "Test",
    slug: "test",
    description: "Day-based syllabus, guidelines, practice, and formal Test MCQ.",
  },
  {
    id: "ospe",
    name: "OSPE",
    slug: "ospe",
    description: "OSPE stations, packs, and related material.",
  },
  {
    id: "lectures",
    name: "Lectures",
    slug: "lectures",
    description: "Lecture videos and recordings.",
  },
  {
    id: "books",
    name: "Books",
    slug: "books",
    description: "Reference books and complete texts.",
  },
  {
    id: "past_papers",
    name: "Past Papers",
    slug: "past-papers",
    description: "Past paper sets and archives.",
  },
  {
    id: "notes",
    name: "Notes",
    slug: "notes",
    description: "Class notes and concise write-ups.",
  },
  {
    id: "guidelines",
    name: "Guidelines",
    slug: "guidelines",
    description: "Study guidelines and protocols.",
  },
  {
    id: "flashcards",
    name: "Flashcards",
    slug: "flashcards",
    description: "Coming soon — placeholder only.",
    placeholder: true,
  },
] as const;

export function findCategoryById(
  id: string
): BlockCategoryDef | null {
  return BLOCK_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function findCategoryBySlug(
  slug: string
): BlockCategoryDef | null {
  return BLOCK_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export type TestDaySlotDef = {
  id: TestDaySlotId;
  name: string;
  slug: string;
  description: string;
};

export const TEST_DAY_SLOTS: readonly TestDaySlotDef[] = [
  {
    id: "syllabus",
    name: "Syllabus",
    slug: "syllabus",
    description: "Day syllabus and coverage outline.",
  },
  {
    id: "guidelines",
    name: "Guidelines",
    slug: "guidelines",
    description: "Study guidelines for this day.",
  },
  {
    id: "one_liners",
    name: "One-liners",
    slug: "one-liners",
    description: "High-yield one-liners.",
  },
  {
    id: "practice_mcqs",
    name: "Practice MCQs",
    slug: "practice-mcqs",
    description: "Untimed practice with instant feedback.",
  },
  {
    id: "test_mcq",
    name: "Test MCQ",
    slug: "test-mcq",
    description: "Formal timed Test MCQ (exam engine).",
  },
] as const;

export function findDaySlotBySlug(slug: string): TestDaySlotDef | null {
  return TEST_DAY_SLOTS.find((s) => s.slug === slug) ?? null;
}
