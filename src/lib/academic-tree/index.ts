export type {
  AcademicNodeKind,
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
  buildStructuralAcademicTree,
  findCategoryInSubject,
  findDayFolder,
  findFolderBySlug,
  findSubjectInTree,
  structuralAcademicTreeAdapter,
} from "./adapter.ts";

export { searchAcademicTreeNames } from "./search.ts";

export { hrefForAcademicSearchHit } from "./hit-href.ts";

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
  searchHref,
  surfaceBasePath,
  surfaceLabel,
} from "./paths.ts";

export {
  buildAcademicBreadcrumbs,
  type BreadcrumbCrumb,
} from "./breadcrumbs.ts";
