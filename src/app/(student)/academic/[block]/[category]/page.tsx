import { BlockCategoryPage } from "@/components/academic/block-category-page";
import {
  loadAcademicBrowseForYear,
  requireBlock,
  requireCategory,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { notFound } from "next/navigation";

export default async function AcademicBlockCategoryPage({
  params,
}: {
  params: Promise<{ block: string; category: string }>;
}) {
  const { block: blockSlug, category: categorySlug } = await params;
  const yearNumber = yearNumberForBlockSlug(blockSlug);
  if (yearNumber == null) notFound();
  const ctx = await loadAcademicBrowseForYear(yearNumber);
  const subject = requireBlock(ctx.tree, blockSlug);
  const { categoryId } = requireCategory(subject, categorySlug);
  return (
    <BlockCategoryPage
      tree={ctx.tree}
      subject={subject}
      categoryId={categoryId}
    />
  );
}
