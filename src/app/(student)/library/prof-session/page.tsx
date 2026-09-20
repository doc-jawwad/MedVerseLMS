import { ProfSessionHomeView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import { loadAcademicBrowse } from "@/lib/academic-tree/browse";

export default async function LibraryProfSessionPage() {
  const ctx = await loadAcademicBrowse("library");
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session unlocks with a live subscription. Browse unlocked Resources while you apply."
      />
    );
  }
  return <ProfSessionHomeView surface="library" tree={ctx.tree} />;
}
