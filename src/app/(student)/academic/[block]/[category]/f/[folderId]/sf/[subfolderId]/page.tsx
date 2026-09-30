import { redirect, notFound } from "next/navigation";
import { McqBankSubfolderDetailPage } from "@/components/library/mcq-bank-subfolder-detail-page";
import {
  loadAcademicBrowseForYear,
  requireBlock,
  requireCategory,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import {
  ACADEMIC_BASE_PATH,
  buildAcademicBreadcrumbs,
  categorySlugFromId,
  folderHref,
} from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";

export default async function AcademicMcqBankSubfolderPage({
  params,
}: {
  params: Promise<{
    block: string;
    category: string;
    folderId: string;
    subfolderId: string;
  }>;
}) {
  const {
    block: blockSlug,
    category: categorySlug,
    folderId,
    subfolderId,
  } = await params;
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

  const { data: subfolder } = await supabase
    .from("mcq_bank_subfolders")
    .select("name")
    .eq("id", subfolderId)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!subfolder) notFound();

  const mcqCategorySlug = categorySlugFromId("mcq_bank");
  const folderBackHref = folderHref(
    subject.product_key,
    mcqCategorySlug,
    folderId
  );

  const breadcrumbs = [
    ...buildAcademicBreadcrumbs({
      yearName: ctx.tree.year_name,
      yearNumber: ctx.tree.year_number,
      blockName: subject.name,
      blockSlug: subject.product_key,
      categoryName: "MCQ Bank",
      categorySlug: mcqCategorySlug,
      folderName: folder.name,
      folderSlug: folderId,
    }).slice(0, -1),
    { label: folder.name, href: folderBackHref },
    { label: subfolder.name },
  ];

  return (
    <McqBankSubfolderDetailPage
      subjectId={subjectId}
      folderId={folderId}
      subfolderId={subfolderId}
      breadcrumbs={breadcrumbs}
      backHref={folderBackHref}
    />
  );
}
