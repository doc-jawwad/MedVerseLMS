import { ProfSessionSlotPage } from "@/components/academic/prof-session-slot-page";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireDaySlot,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function AcademicProfSessionSlotPage({
  params,
}: {
  params: Promise<{ day: string; slot: string }>;
}) {
  const { day: daySlug, slot: slotSlug } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session day contents unlock with a live subscription."
      />
    );
  }
  const day = requireProfDay(ctx.tree, daySlug);
  const { slot, slotId } = requireDaySlot(day, slotSlug);
  return (
    <ProfSessionSlotPage
      tree={ctx.tree}
      day={day}
      slotId={slotId}
      slot={slot}
    />
  );
}
