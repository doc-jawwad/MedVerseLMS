import { ProfSessionDayView } from "@/components/academic/academic-browse-views";
import {
  loadAcademicBrowse,
  requireProfDay,
} from "@/lib/academic-tree/browse";

export default async function ResourcesProfSessionDayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day: daySlug } = await params;
  const ctx = await loadAcademicBrowse("resources");
  const day = requireProfDay(ctx.tree, daySlug);
  return (
    <ProfSessionDayView surface="resources" tree={ctx.tree} day={day} />
  );
}
