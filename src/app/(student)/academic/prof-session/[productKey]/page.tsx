import {
  ProfSessionSubjectView,
} from "@/components/academic/academic-browse-views";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireProfSubject,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { redirect } from "next/navigation";
import { ACADEMIC_BASE_PATH } from "@/lib/academic-tree";

export default async function AcademicProfSessionSubjectPage({
  params,
}: {
  params: Promise<{ productKey: string }>;
}) {
  const { productKey } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session unlocks with a live subscription. Subject contents are not available on the free plan."
      />
    );
  }

  const yearForKey = yearNumberForBlockSlug(productKey);
  if (yearForKey != null && yearForKey !== ctx.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const subject = requireProfSubject(ctx.tree, productKey);
  return <ProfSessionSubjectView tree={ctx.tree} subject={subject} />;
}
