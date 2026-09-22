import { notFound } from "next/navigation";
import { MaterialLibraryPage } from "@/components/library/material-library-page";
import {
  buildAcademicBreadcrumbs,
  findProfSessionCategoryById,
  profSessionSubjectHref,
  type AcademicProfSessionSubject,
  type AcademicTree,
  type ProfSessionCategoryId,
} from "@/lib/academic-tree";
import type { FolderLibraryType } from "@/lib/library/types";

const MATERIAL_PS_CATEGORIES = new Set<ProfSessionCategoryId>([
  "syllabus",
  "schedule",
  "books",
  "notes",
  "lectures",
  "ospe_past",
  "ospe_material",
  "ospe_lectures",
]);

/**
 * Block-level Prof. Session category content (content_surface = prof_session).
 */
export async function ProfSessionCategoryPage({
  tree,
  subject,
  categoryId,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
  categoryId: ProfSessionCategoryId;
}) {
  if (categoryId === "mcq_bank") notFound();
  if (!MATERIAL_PS_CATEGORIES.has(categoryId)) notFound();

  const def = findProfSessionCategoryById(categoryId);
  if (!def?.libraryType) notFound();

  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: def.name,
    categorySlug: def.slug,
  });
  const backHref = profSessionSubjectHref(subject.product_key);
  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;

  return (
    <MaterialLibraryPage
      libraryType={def.libraryType as FolderLibraryType}
      mode="full"
      subjectId={subjectId}
      contentSurface="prof_session"
      breadcrumbs={breadcrumbs}
      title={def.name}
      description={def.description}
      backHref={backHref}
    />
  );
}
