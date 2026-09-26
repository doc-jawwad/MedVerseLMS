import { redirect, notFound } from "next/navigation";
import { McqBankFolderDetailPage } from "@/components/library/mcq-bank-folder-detail-page";
import {
  loadAcademicBrowseForYear,
  requireBlock,
  requireCategory,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import {
  ACADEMIC_BASE_PATH,
  buildAcademicBreadcrumbs,
  categoryHref,
  categorySlugFromId,
} from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";

export default async function AcademicMcqBankFolderPage({
  params,
}: {
  params: Promise<{ block: string; category: string; folderId: string }>;
}) {
  const { block: blockSlug, category: categorySlug, folderId } = await params;
  const yearNumber = yearNumberForBlockSlug(blockSlug);
  if (yearNumber == null) notFound();

  const { enrollment, supabase } = await requireStudent();
  if (yearNumber !== enrollment.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const ctx = await loadAcademicBrowseForYear(yearNumber);
  const subject = requireBlock(ctx.tree, blockSlug);
  const { categoryId } = requireCategory(subject, categorySlug);

  if (categoryId !== "mcq_bank") notFound();

  const subjectId = subject.subject_id.startsWith("product:")
    ? undefined
    : subject.subject_id;
  if (!subjectId) notFound();

  const { data: folder } = await supabase
    .from("mcq_bank_folders")
    .select("name")
    .eq("id", folderId)
    .eq("academic_product_subject_id", subjectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!folder) notFound();

  const breadcrumbs = buildAcademicBreadcrumbs({
    yearName: ctx.tree.year_name,
    yearNumber: ctx.tree.year_number,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: "MCQ Bank",
    categorySlug: categorySlugFromId("mcq_bank"),
    folderName: folder.name,
    folderSlug: folderId,
  });

  return (
    <McqBankFolderDetailPage
      subjectId={subjectId}
      folderId={folderId}
      breadcrumbs={breadcrumbs}
      backHref={categoryHref(
        subject.product_key,
        categorySlugFromId("mcq_bank")
      )}
    />
  );
}
