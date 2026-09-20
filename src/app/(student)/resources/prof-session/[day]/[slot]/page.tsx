import { ProfSessionSlotPage } from "@/components/academic/prof-session-slot-page";
import {
  loadAcademicBrowse,
  requireDaySlot,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function ResourcesProfSessionSlotPage({
  params,
}: {
  params: Promise<{ day: string; slot: string }>;
}) {
  const { day: daySlug, slot: slotSlug } = await params;
  const ctx = await loadAcademicBrowse("resources");
  const day = requireProfDay(ctx.tree, daySlug);
  const { slot, slotId } = requireDaySlot(day, slotSlug);
  return (
    <ProfSessionSlotPage
      surface="resources"
      tree={ctx.tree}
      day={day}
      slot={slot}
      slotId={slotId}
    />
  );
}
