import { ProfSessionDayView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function LibraryProfSessionDayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day: daySlug } = await params;
  const ctx = await loadAcademicBrowse("library");
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session unlocks with a live subscription. Browse unlocked Resources while you apply."
      />
    );
  }
  const day = requireProfDay(ctx.tree, daySlug);
  return <ProfSessionDayView surface="library" tree={ctx.tree} day={day} />;
}
