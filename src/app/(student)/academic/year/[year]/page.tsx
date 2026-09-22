import { redirect } from "next/navigation";
import { ClassHomeView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowseForYear,
  requireYearNumber,
} from "@/lib/academic-tree/browse";
import { yearHref } from "@/lib/academic-tree";
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
    redirect(yearHref(enrollment.year_number));
  }

  const ctx = await loadAcademicBrowseForYear(yearNumber);
  return <ClassHomeView tree={ctx.tree} error={ctx.error} />;
}
