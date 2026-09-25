import { notFound } from "next/navigation";
import { McqBankFoldersPage } from "@/components/library/mcq-bank-folders-page";
import { PearlPointsLibraryPage } from "@/components/library/pearl-points-library-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import {
  blockHref,
  buildAcademicBreadcrumbs,
  categorySlugFromId,
  type AcademicTree,
  type AcademicTreeSubject,
  type BlockCategoryId,
} from "@/lib/academic-tree";
import type { FolderLibraryType } from "@/lib/library/types";

const MATERIAL_CATEGORIES = new Set<BlockCategoryId>([
  "guidelines",
  "ospe_material",
  "ospe_lectures",
  "books",
  "notes",
  "lectures",
]);

/**
 * Block category content — hierarchy is open; item access is entitlement-gated.
 * Always uses browse mode (no section lock on the category itself).
 */
export async function BlockCategoryPage({
  tree,
  subject,
  categoryId,
}: {
  tree: AcademicTree;
  subject: AcademicTreeSubject;
  categoryId: BlockCategoryId;
}) {
  const category = subject.categories.find((c) => c.id === categoryId);
  if (!category) notFound();

  const categorySlug = categorySlugFromId(categoryId);
  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    yearNumber: tree.year_number,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: category.name,
    categorySlug,
  });
  const backHref = blockHref(subject.product_key);
  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;

  if (categoryId === "mcq_bank") {
    if (!subjectId) notFound();
    return (
      <McqBankFoldersPage
        subjectId={subjectId}
        breadcrumbs={breadcrumbs}
        title={category.name}
        backHref={backHref}
      />
    );
  }

  if (categoryId === "pearl_points") {
    return (
      <PearlPointsLibraryPage
        mode="resources"
        subjectId={subjectId}
        breadcrumbs={breadcrumbs}
        title={category.name}
        backHref={backHref}
      />
    );
  }

  if (MATERIAL_CATEGORIES.has(categoryId)) {
    return (
      <MaterialLibraryPage
        libraryType={categoryId as FolderLibraryType}
        mode="resources"
        subjectId={subjectId}
        breadcrumbs={breadcrumbs}
        title={category.name}
        backHref={backHref}
      />
    );
  }

  notFound();
}
