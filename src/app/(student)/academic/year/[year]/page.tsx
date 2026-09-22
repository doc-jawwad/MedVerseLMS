import { redirect } from "next/navigation";
import { ClassHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowseForYear,
  requireYearNumber,
} from "@/lib/academic-tree/browse";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";
import { requireStudent } from "@/lib/auth/require-user";

export default async function AcademicYearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearRaw } = await params;
  const yearNumber = requireYearNumber(yearRaw);
  const { enrollment } = await requireStudent();

  if (yearNumber !== enrollment.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const ctx = await loadAcademicBrowseForYear(yearNumber);
  return <ClassHomeView tree={ctx.tree} error={ctx.error} />;
}
