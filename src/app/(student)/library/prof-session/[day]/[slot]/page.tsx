import { ProfSessionSlotPage } from "@/components/academic/prof-session-slot-page";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireDaySlot,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function LibraryProfSessionSlotPage({
  params,
}: {
  params: Promise<{ day: string; slot: string }>;
}) {
  const { day: daySlug, slot: slotSlug } = await params;
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
  const { slot, slotId } = requireDaySlot(day, slotSlug);
  return (
    <ProfSessionSlotPage
      surface="library"
      tree={ctx.tree}
      day={day}
      slot={slot}
      slotId={slotId}
    />
  );
}
