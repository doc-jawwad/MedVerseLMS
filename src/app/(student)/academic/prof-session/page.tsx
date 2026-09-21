import { ProfSessionHomeView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import { loadAcademicBrowse } from "@/lib/academic-tree/browse";

export const metadata = { title: "Prof. Session — MedVerse LMS" };

export default async function AcademicProfSessionPage() {
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session unlocks with a live subscription. You can still browse every class, Block, and category — individual items stay entitlement-gated."
      />
    );
  }
  return <ProfSessionHomeView tree={ctx.tree} />;
}
