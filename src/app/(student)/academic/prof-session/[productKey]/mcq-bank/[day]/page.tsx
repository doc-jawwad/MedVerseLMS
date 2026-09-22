import { ProfSessionDayView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireProfDay,
  requireProfSubject,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

export default async function AcademicProfSessionDayPage({
  params,
}: {
  params: Promise<{ productKey: string; day: string }>;
}) {
  const { productKey, day: daySlug } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session days unlock with a live subscription."
      />
    );
  }

  const yearForKey = yearNumberForBlockSlug(productKey);
  if (yearForKey != null && yearForKey !== ctx.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const subject = requireProfSubject(ctx.tree, productKey);
  const day = requireProfDay(subject, daySlug);
  return (
    <ProfSessionDayView tree={ctx.tree} subject={subject} day={day} />
  );
}
