import { BlockCategoryPage } from "@/components/academic/block-category-page";
import {
  loadAcademicBrowse,
  requireBlock,
  requireCategory,
} from "@/lib/academic-tree/browse";

export default async function ResourcesBlockCategoryPage({
  params,
}: {
  params: Promise<{ block: string; category: string }>;
}) {
  const { block, category: categorySlug } = await params;
  const ctx = await loadAcademicBrowse("resources");
  const subject = requireBlock(ctx.tree, block);
  const { categoryId } = requireCategory(subject, categorySlug);
  return (
    <BlockCategoryPage
      surface="resources"
      tree={ctx.tree}
      subject={subject}
      categoryId={categoryId}
    />
  );
}
