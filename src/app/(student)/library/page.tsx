import { ClassHomeView } from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import { loadAcademicBrowse } from "@/lib/academic-tree/browse";

export default async function LibraryHomePage() {
  const ctx = await loadAcademicBrowse("library");
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Library"
        description="The full class library unlocks with a live subscription. Browse unlocked items under Resources."
      />
    );
  }
  return (
    <ClassHomeView surface="library" tree={ctx.tree} error={ctx.error} />
  );
}
