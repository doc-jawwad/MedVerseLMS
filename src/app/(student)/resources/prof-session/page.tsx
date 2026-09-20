import { ProfSessionHomeView } from "@/components/academic/academic-browse-views";
import { loadAcademicBrowse } from "@/lib/academic-tree/browse";

export default async function ResourcesProfSessionPage() {
  const ctx = await loadAcademicBrowse("resources");
  return <ProfSessionHomeView surface="resources" tree={ctx.tree} />;
}
