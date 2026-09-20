export type {
  AcademicNodeKind,
  AcademicProfSession,
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
  TestDaySlotId,
} from "./types.ts";

export {
  BLOCK_CATEGORIES,
  BLOCK_PRODUCT_DEFS,
  CLASS_DISPLAY_BY_YEAR_NUMBER,
  PROF_SESSION_LABEL,
  PROF_SESSION_SLUG,
  TEST_DAY_SLOTS,
  blocksForYearNumber,
  classDisplayName,
  findBlockProduct,
  findCategoryById,
  findCategoryBySlug,
  findDaySlotBySlug,
  isBlockProductKey,
} from "./product-structure.ts";

export {
  buildDefaultProfSessionDays,
  buildStructuralAcademicTree,
  findCategoryInSubject,
  findDayFolder,
  findFolderBySlug,
  findSubjectInTree,
  structuralAcademicTreeAdapter,
} from "./adapter.ts";

export { searchAcademicTreeNames } from "./search.ts";

export { hrefForAcademicSearchHit } from "./hit-href.ts";

export { mapRpcTree, productKeyForSubjectName } from "./map-rpc-tree.ts";

// loadAcademicTree / browse helpers stay in server-only modules — do not
// re-export from this barrel so client/unit imports stay free of `server-only`.

export {
  blockHref,
  categoryHref,
  categorySlugFromId,
  classHref,
  dayHref,
  daySlotHref,
  folderHref,
  isKnownDaySlotSlug,
  parseCategorySlug,
  profSessionHref,
  searchHref,
  surfaceBasePath,
  surfaceLabel,
} from "./paths.ts";

export {
  buildAcademicBreadcrumbs,
  type BreadcrumbCrumb,
} from "./breadcrumbs.ts";
