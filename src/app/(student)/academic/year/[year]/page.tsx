import { ClassHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowseForYear,
  requireYearNumber,
} from "@/lib/academic-tree/browse";

export default async function AcademicYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearRaw } = await params;
  const yearNumber = requireYearNumber(yearRaw);
  const ctx = await loadAcademicBrowseForYear(yearNumber);
  return <ClassHomeView tree={ctx.tree} error={ctx.error} />;
}
