import { BlockHomeView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireBlock,
} from "@/lib/academic-tree/browse";

export default async function LibraryBlockPage({
  params,
}: {
  params: Promise<{ block: string }>;
}) {
  const { block } = await params;
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
  return (
    <BlockHomeView surface="library" tree={ctx.tree} subject={subject} />
  );
}
