import { notFound } from "next/navigation";
import { McqBankPage } from "@/components/library/mcq-bank-page";
import { PearlPointsLibraryPage } from "@/components/library/pearl-points-library-page";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import {
  buildAcademicBreadcrumbs,
  categorySlugFromId,
  type AcademicTree,
  type AcademicTreeSubject,
  type AcademicTreeSurface,
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

export async function BlockCategoryPage({
  surface,
  tree,
  subject,
  categoryId,
}: {
  surface: AcademicTreeSurface;
  tree: AcademicTree;
  subject: AcademicTreeSubject;
  categoryId: BlockCategoryId;
}) {
  const category = subject.categories.find((c) => c.id === categoryId);
  if (!category) notFound();

  const categorySlug = categorySlugFromId(categoryId);
  const breadcrumbs = buildAcademicBreadcrumbs({
    surface,
    yearName: tree.year_name,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: category.name,
    categorySlug,
  });
  const backHref = `/${surface}/${subject.product_key}`;
  const mode = surface === "resources" ? "resources" : "full";
  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;

  if (categoryId === "mcq_bank") {
    return (
      <McqBankPage
        mode={mode}
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
        mode={mode}
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
        mode={mode}
        subjectId={subjectId}
        breadcrumbs={breadcrumbs}
        title={category.name}
        backHref={backHref}
      />
    );
  }

  notFound();
}
