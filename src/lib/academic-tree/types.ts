/**
 * Student academic tree shapes for Resources / Library surfaces.
 * Aligns with docs/schema-lane-integration-contract.md (`get_academic_tree`,
 * `search_academic_tree`). No migrations — adapters may stub until Data Spine ships.
 */

export type AcademicTreeSurface = "resources" | "library";

/** Product block / Final Year subject keys (stable UI slugs). */
export type BlockProductKey =
  | "block-1"
  | "block-2"
  | "block-3"
  | "block-4"
  | "block-5"
  | "block-6"
  | "block-7"
  | "block-8"
  | "block-9"
  | "block-10"
  | "block-11"
  | "block-12"
  | "medicine"
  | "surgery"
  | "gynecology"
  | "pediatrics";

/**
 * Block category ids. Student chrome omits `notes` (storage/deep-link only).
 * See BLOCK_CATEGORIES / NOTES_CATEGORY in product-structure.
 */
export type BlockCategoryId =
  | "mcq_bank"
  | "pearl_points"
  | "guidelines"
  | "ospe_material"
  | "ospe_lectures"
  | "books"
  | "notes"
  | "lectures";

/** Fixed containers under each Prof. Session day (product law). */
export type TestDaySlotId =
  | "syllabus"
  | "guidelines"
  | "one_liners"
  | "practice_mcqs"
  | "test_mcq";

export type AcademicNodeKind =
  | "class"
  | "block"
  | "category"
  | "folder"
  | "day"
  | "day_slot"
  | "item"
  | "prof_session";

export type AcademicTreeItemKind =
  | "material"
  | "practice_mcq"
  | "test_mcq"
  | "pearl"
  | "placeholder";

/** Catalog-safe item: never includes Drive URLs, stems, or correct_key. */
export type AcademicTreeItem = {
  id: string;
  name: string;
  kind: AcademicTreeItemKind;
  locked: boolean;
};

export type AcademicTreeFolder = {
  id: string;
  /** Product / URL slug when present. */
  slug: string;
  name: string;
  locked: boolean;
  parent_id: string | null;
  /** Nested folders (subfolders) or days under a category. */
  children: AcademicTreeFolder[];
  items: AcademicTreeItem[];
  /** True when this folder is a Prof. Session "Day N" container. */
  is_day?: boolean;
  /** When set, this node is one of the fixed day slots. */
  day_slot?: TestDaySlotId;
};

export type AcademicTreeCategory = {
  id: BlockCategoryId;
  name: string;
  locked: boolean;
  /** Reserved for future placeholders; block categories are live today. */
  placeholder?: boolean;
  folders: AcademicTreeFolder[];
};

export type AcademicTreeSubject = {
  /** subjects.id when known; product key used as id until Data Spine maps UUIDs. */
  subject_id: string;
  product_key: BlockProductKey;
  name: string;
  locked: boolean;
  categories: AcademicTreeCategory[];
};

/** Prof. Session sits beside class Blocks — never nested under a Block. */
export type AcademicProfSession = {
  locked: boolean;
  /** Only days that exist (Admin-created when Data Spine provides them). */
  days: AcademicTreeFolder[];
};

export type AcademicTree = {
  surface: AcademicTreeSurface;
  year_id: string;
  year_number: number;
  year_name: string;
  subjects: AcademicTreeSubject[];
  prof_session: AcademicProfSession;
  /** true when payload came from stub adapter, not live RPC. */
  from_adapter: boolean;
};

/**
 * Name-only search hit. Never includes stem / PDF / transcript body.
 * `kind` is the content type; `class_name` is the class (years display name).
 */
export type AcademicSearchHit = {
  kind: Extract<
    AcademicNodeKind,
    "class" | "block" | "category" | "folder" | "day" | "prof_session"
  >;
  id: string;
  name: string;
  path_labels: string[];
  locked: boolean;
  /** Class display name (years / enrollment class). */
  class_name: string;
  href: string;
};

export type AcademicTreeLoadState =
  | { status: "ok"; tree: AcademicTree }
  | { status: "empty"; tree: AcademicTree; message: string }
  | { status: "error"; message: string };

export type GetAcademicTreeInput = {
  surface: AcademicTreeSurface;
  year_id: string;
  year_number: number;
  year_name: string;
  /** When false on library surface, every node is locked (UX). */
  has_live_subscription: boolean;
};

export type AcademicTreeAdapter = {
  getAcademicTree(input: GetAcademicTreeInput): Promise<AcademicTree>;
  searchAcademicTree(input: {
    query: string;
    tree: AcademicTree;
    limit?: number;
  }): AcademicSearchHit[];
};
