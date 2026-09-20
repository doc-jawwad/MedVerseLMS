import { BlockCategoryPage } from "@/components/academic/block-category-page";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireBlock,
  requireCategory,
} from "@/lib/academic-tree/browse";

export default async function LibraryBlockCategoryPage({
  params,
}: {
  params: Promise<{ block: string; category: string }>;
}) {
  const { block, category: categorySlug } = await params;
  const ctx = await loadAcademicBrowse("library");
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Library"
        description="The full class library unlocks with a live subscription. Browse unlocked items under Resources."
      />
    );
  }
  const subject = requireBlock(ctx.tree, block);
  const { categoryId } = requireCategory(subject, categorySlug);
  return (
    <BlockCategoryPage
      surface="library"
      tree={ctx.tree}
      subject={subject}
      categoryId={categoryId}
    />
  );
}
