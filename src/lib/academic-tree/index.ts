export type {
  AcademicNodeKind,
  AcademicProfSession,
  AcademicProfSessionCategory,
  AcademicProfSessionSubject,
  AcademicSearchHit,
  AcademicTree,
  AcademicTreeAdapter,
  AcademicTreeCategory,
  AcademicTreeFolder,
  AcademicTreeItem,
  AcademicTreeItemKind,
  AcademicTreeLoadState,
  AcademicTreeSubject,
  AcademicTreeSurface,
  BlockCategoryId,
  BlockProductKey,
  GetAcademicTreeInput,
  ProfSessionCategoryId,
  TestDaySlotId,
} from "./types.ts";

export {
  ALL_BLOCK_CATEGORIES,
  BLOCK_CATEGORIES,
  BLOCK_CHROME_GROUPS,
  BLOCK_PRODUCT_DEFS,
  CLASS_DISPLAY_BY_YEAR_NUMBER,
  NOTES_CATEGORY,
  OSPE_GROUP_CATEGORY_IDS,
  OSPE_PRACTICE_HREF,
  PROF_SESSION_CATEGORIES,
  PROF_SESSION_CHROME_GROUPS,
  PROF_SESSION_LABEL,
  PROF_SESSION_MCQ_BANK_SLUG,
  PROF_SESSION_OSPE_GROUP_CATEGORY_IDS,
  PROF_SESSION_SLUG,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  classDisplayName,
  findBlockProduct,
  findCategoryById,
  findCategoryBySlug,
  findDaySlotBySlug,
  findProfSessionCategoryById,
  findProfSessionCategoryBySlug,
  isBlockProductKey,
} from "./product-structure.ts";

export {
  buildStructuralAcademicTree,
  findCategoryInSubject,
  findDayFolder,
  findProfSubjectInTree,
  findSubjectInTree,
  structuralAcademicTreeAdapter,
} from "./adapter.ts";

export { searchAcademicTreeNames } from "./search.ts";

export {
  ACADEMIC_SEARCH_KINDS,
  filterSearchHitsForAccess,
  isSearchRpcCompatError,
  mapAcademicSearchRpcRows,
  resolveAcademicSearchHits,
  type AcademicSearchRpcRow,
} from "./search-resolve.ts";

export { hrefForAcademicSearchHit } from "./hit-href.ts";

export { mapRpcTree, productKeyForSubjectName } from "./map-rpc-tree.ts";

// loadAcademicTree / browse helpers stay in server-only modules — do not
// re-export from this barrel so client/unit imports stay free of `server-only`.

export {
  ACADEMIC_BASE_PATH,
  blockHref,
  categoryHref,
  categorySlugFromId,
  dayHref,
  daySlotHref,
  folderHref,
  isKnownDaySlotSlug,
  isProfSessionCategorySlug,
  profSessionCategoryHref,
  profSessionHref,
  profSessionSubjectHref,
  searchHref,
  subfolderHref,
  surfaceBasePath,
  surfaceLabel,
  yearHref,
} from "./paths.ts";

export {
  buildAcademicBreadcrumbs,
  type BreadcrumbCrumb,
} from "./breadcrumbs.ts";
