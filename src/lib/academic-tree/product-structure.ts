import type {
  BlockCategoryId,
  BlockProductKey,
  ProfSessionCategoryId,
  TestDaySlotId,
} from "./types.ts";

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

export function findBlockProduct(key: string): BlockProductDef | null {
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

/**
 * Student Block chrome leaf categories (Notes + Syllabus included).
 * OSPE Material / Lectures also appear under the OSPE chrome group with Practice.
 * Order matches Academic subject page chrome (OSPE group is separate in UI).
 */
export const BLOCK_CATEGORIES: readonly BlockCategoryDef[] = [
  {
    id: "mcq_bank",
    name: "MCQ Bank",
    slug: "mcq-bank",
    description: "Practice questions with instant feedback.",
  },
  {
    id: "one_liner",
    name: "One Liner",
    slug: "one-liner",
    description: "High-yield PDF folders — open, read, and highlight.",
  },
  {
    id: "guidelines",
    name: "Guidelines",
    slug: "guidelines",
    description: "Study guidelines and protocols.",
  },
  {
    id: "books",
    name: "Books",
    slug: "books",
    description: "Reference books and complete texts.",
  },
  {
    id: "lectures",
    name: "Lectures",
    slug: "lectures",
    description: "Lecture videos and recordings.",
  },
  {
    id: "notes",
    name: "Notes",
    slug: "notes",
    description: "Class notes and concise write-ups.",
  },
  {
    id: "syllabus",
    name: "Syllabus",
    slug: "syllabus",
    description: "Subject syllabus PDFs.",
  },
  {
    id: "ospe_material",
    name: "OSPE Material",
    slug: "ospe-material",
    description: "OSPE PDFs and station packs.",
  },
  {
    id: "ospe_lectures",
    name: "OSPE Lectures",
    slug: "ospe-lectures",
    description: "OSPE lecture videos and recordings.",
  },
] as const;

/** @deprecated Prefer BLOCK_CATEGORIES — Notes is now chrome, not storage-only. */
export const NOTES_CATEGORY: BlockCategoryDef =
  BLOCK_CATEGORIES.find((c) => c.id === "notes")!;

export const ALL_BLOCK_CATEGORIES: readonly BlockCategoryDef[] = BLOCK_CATEGORIES;

/** Category ids folded under the Block OSPE chrome group. */
export const OSPE_GROUP_CATEGORY_IDS = [
  "ospe_material",
  "ospe_lectures",
] as const satisfies readonly BlockCategoryId[];

export const OSPE_PRACTICE_HREF = "/practice/ospe";

export type BlockChromeGroupDef = {
  id: "ospe";
  name: string;
  description: string;
  children: readonly {
    id: string;
    name: string;
    /** Category slug for Material/Lectures; null for Practice. */
    categorySlug: string | null;
    href?: string;
  }[];
};

export const BLOCK_CHROME_GROUPS: readonly BlockChromeGroupDef[] = [
  {
    id: "ospe",
    name: "OSPE",
    description: "OSPE material, lectures, and practice stations.",
    children: [
      {
        id: "ospe_material",
        name: "OSPE Material",
        categorySlug: "ospe-material",
      },
      {
        id: "ospe_lectures",
        name: "OSPE Lectures",
        categorySlug: "ospe-lectures",
      },
      {
        id: "ospe_practice",
        name: "OSPE Practice",
        categorySlug: null,
        href: OSPE_PRACTICE_HREF,
      },
    ],
  },
];

export function findCategoryById(id: string): BlockCategoryDef | null {
  return ALL_BLOCK_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function findCategoryBySlug(slug: string): BlockCategoryDef | null {
  return ALL_BLOCK_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export type TestDaySlotDef = {
  id: TestDaySlotId;
  name: string;
  slug: string;
  description: string;
};

/** Fixed containers under each Prof. Session day (product law). */
export const TEST_DAY_SLOTS: readonly TestDaySlotDef[] = [
  {
    id: "guidelines",
    name: "Guidelines",
    slug: "guidelines",
    description: "Study guidelines for this day.",
  },
  {
    id: "los",
    name: "LoS",
    slug: "los",
    description: "Learning outcomes for this day.",
  },
  {
    id: "practice_mcqs",
    name: "Practice MCQs",
    slug: "practice-mcqs",
    description: "Untimed practice with instant feedback.",
  },
  {
    id: "test_mcq",
    name: "Test MCQs",
    slug: "test-mcq",
    description: "Formal timed Test MCQ (exam engine).",
  },
  {
    id: "one_liners",
    name: "One-Liners",
    slug: "one-liners",
    description: "Day-scoped statements for this Prof. Session day (separate from Block One Liner).",
  },
] as const;

export function findDaySlotBySlug(slug: string): TestDaySlotDef | null {
  return TEST_DAY_SLOTS.find((s) => s.slug === slug) ?? null;
}

export type ProfSessionCategoryDef = {
  id: ProfSessionCategoryId;
  name: string;
  slug: string;
  description: string;
  /** When set, maps to material_folders.library_type. */
  libraryType?: string;
};

/**
 * Student Prof. Session Block chrome (Notes included).
 * OSPE Material / Lectures / Past also appear under the OSPE group with Practice.
 */
export const PROF_SESSION_CATEGORIES: readonly ProfSessionCategoryDef[] = [
  {
    id: "syllabus",
    name: "Syllabus",
    slug: "syllabus",
    description: "Block syllabus PDF.",
    libraryType: "syllabus",
  },
  {
    id: "schedule",
    name: "Schedule",
    slug: "schedule",
    description: "Block schedule (PDF or structured materials).",
    libraryType: "schedule",
  },
  {
    id: "books",
    name: "Books",
    slug: "books",
    description: "Reference books for this Prof. Session subject.",
    libraryType: "books",
  },
  {
    id: "notes",
    name: "Notes",
    slug: "notes",
    description: "Notes for this Prof. Session subject.",
    libraryType: "notes",
  },
  {
    id: "lectures",
    name: "Lectures",
    slug: "lectures",
    description: "Lecture videos and recordings.",
    libraryType: "lectures",
  },
  {
    id: "ospe_past",
    name: "Past OSPE",
    slug: "ospe-past",
    description: "Past OSPE PDFs and pictures.",
    libraryType: "ospe_past",
  },
  {
    id: "ospe_material",
    name: "OSPE Material",
    slug: "ospe-material",
    description: "OSPE PDFs and station packs.",
    libraryType: "ospe_material",
  },
  {
    id: "ospe_lectures",
    name: "OSPE Lectures",
    slug: "ospe-lectures",
    description: "OSPE lecture videos and recordings.",
    libraryType: "ospe_lectures",
  },
  {
    id: "mcq_bank",
    name: "MCQ Bank",
    slug: "mcq-bank",
    description: "Admin-created Days with Guidelines, LoS, practice, tests, and one-liners.",
  },
] as const;

export const PROF_SESSION_OSPE_GROUP_CATEGORY_IDS = [
  "ospe_past",
  "ospe_material",
  "ospe_lectures",
] as const satisfies readonly ProfSessionCategoryId[];

export const PROF_SESSION_CHROME_GROUPS = [
  {
    id: "ospe" as const,
    name: "OSPE",
    description: "Past OSPE, practice stations, and OSPE lectures.",
    children: [
      {
        id: "ospe_past",
        name: "Past OSPE",
        categorySlug: "ospe-past",
      },
      {
        id: "ospe_material",
        name: "OSPE Material",
        categorySlug: "ospe-material",
      },
      {
        id: "ospe_lectures",
        name: "OSPE Lectures",
        categorySlug: "ospe-lectures",
      },
      {
        id: "ospe_practice",
        name: "Practice OSPE",
        categorySlug: null as string | null,
        href: OSPE_PRACTICE_HREF,
      },
    ],
  },
] as const;

export function findProfSessionCategoryById(
  id: string
): ProfSessionCategoryDef | null {
  return PROF_SESSION_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function findProfSessionCategoryBySlug(
  slug: string
): ProfSessionCategoryDef | null {
  return PROF_SESSION_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/** Prof. Session sits beside class Blocks — never nested under a Block. */
export const PROF_SESSION_LABEL = "Prof. Session";
export const PROF_SESSION_SLUG = "prof-session";
export const PROF_SESSION_MCQ_BANK_SLUG = "mcq-bank";
