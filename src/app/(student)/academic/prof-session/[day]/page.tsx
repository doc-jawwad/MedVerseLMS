import { ProfSessionDayView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function AcademicProfSessionDayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day: daySlug } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session days unlock with a live subscription. Day contents are not available on the free plan."
      />
    );
  }
  const day = requireProfDay(ctx.tree, daySlug);
  return <ProfSessionDayView tree={ctx.tree} day={day} />;
}
