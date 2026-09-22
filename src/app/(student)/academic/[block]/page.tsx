import { redirect } from "next/navigation";
import { BlockHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowseForYear,
  requireBlock,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";
import { notFound } from "next/navigation";

export default async function AcademicBlockPage({
  params,
}: {
  params: Promise<{ block: string }>;
}) {
  const { block: blockSlug } = await params;
  const yearNumber = yearNumberForBlockSlug(blockSlug);
  if (yearNumber == null) notFound();

  const { enrollment } = await requireStudent();
  if (yearNumber !== enrollment.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const ctx = await loadAcademicBrowseForYear(yearNumber);
  const subject = requireBlock(ctx.tree, blockSlug);
  return <BlockHomeView tree={ctx.tree} subject={subject} />;
}
