import { ProfSessionSlotPage } from "@/components/academic/prof-session-slot-page";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireDaySlot,
  requireProfDay,
  requireProfSubject,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

export default async function AcademicProfSessionSlotPage({
  params,
}: {
  params: Promise<{ productKey: string; day: string; slot: string }>;
}) {
  const { productKey, day: daySlug, slot: slotSlug } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session day contents unlock with a live subscription."
      />
    );
  }

  const yearForKey = yearNumberForBlockSlug(productKey);
  if (yearForKey != null && yearForKey !== ctx.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const subject = requireProfSubject(ctx.tree, productKey);
  const day = requireProfDay(subject, daySlug);
  const { slot, slotId } = requireDaySlot(day, slotSlug);
  return (
    <ProfSessionSlotPage
      tree={ctx.tree}
      subject={subject}
      day={day}
      slotId={slotId}
      slot={slot}
    />
  );
}
