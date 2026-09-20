import { BlockHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowse,
  requireBlock,
} from "@/lib/academic-tree/browse";

export default async function ResourcesBlockPage({
  params,
}: {
  params: Promise<{ block: string }>;
}) {
  const { block } = await params;
  const ctx = await loadAcademicBrowse("resources");
  const subject = requireBlock(ctx.tree, block);
  return (
    <BlockHomeView surface="resources" tree={ctx.tree} subject={subject} />
  );
}
