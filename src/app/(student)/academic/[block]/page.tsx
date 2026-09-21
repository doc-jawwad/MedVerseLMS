import { BlockHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowseForYear,
  requireBlock,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { notFound } from "next/navigation";

export default async function AcademicBlockPage({
  params,
}: {
  params: Promise<{ block: string }>;
}) {
  const { block: blockSlug } = await params;
  const yearNumber = yearNumberForBlockSlug(blockSlug);
  if (yearNumber == null) notFound();
  const ctx = await loadAcademicBrowseForYear(yearNumber);
  const subject = requireBlock(ctx.tree, blockSlug);
  return <BlockHomeView tree={ctx.tree} subject={subject} />;
}
