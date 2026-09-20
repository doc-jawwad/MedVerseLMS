import { ClassHomeView } from "@/components/academic/academic-browse-views";
import { loadAcademicBrowse } from "@/lib/academic-tree/browse";

export default async function ResourcesHomePage() {
  const ctx = await loadAcademicBrowse("resources");
  return (
    <ClassHomeView surface="resources" tree={ctx.tree} error={ctx.error} />
  );
}
