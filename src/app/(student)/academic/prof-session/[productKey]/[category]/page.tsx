import {
  ProfSessionMcqBankView,
} from "@/components/academic/academic-browse-views";
import { ProfSessionCategoryPage } from "@/components/academic/prof-session-category-page";
import { SectionLock } from "@/components/subscription/section-lock";
import {
  loadAcademicBrowse,
  requireProfCategory,
  requireProfSubject,
  yearNumberForBlockSlug,
} from "@/lib/academic-tree/browse";
import { redirect } from "next/navigation";
import {
  ACADEMIC_BASE_PATH,
  PROF_SESSION_MCQ_BANK_SLUG,
} from "@/lib/academic-tree";

export default async function AcademicProfSessionCategoryPage({
  params,
}: {
  params: Promise<{ productKey: string; category: string }>;
}) {
  const { productKey, category: categorySlug } = await params;
  const ctx = await loadAcademicBrowse();
  if (!ctx.hasLiveAccess) {
    return (
      <SectionLock
        title="Prof. Session"
        description="Prof. Session unlocks with a live subscription."
      />
    );
  }

  const yearForKey = yearNumberForBlockSlug(productKey);
  if (yearForKey != null && yearForKey !== ctx.year_number) {
    redirect(ACADEMIC_BASE_PATH);
  }

  const subject = requireProfSubject(ctx.tree, productKey);
  const { categoryId } = requireProfCategory(subject, categorySlug);

  if (categoryId === "mcq_bank" || categorySlug === PROF_SESSION_MCQ_BANK_SLUG) {
    return <ProfSessionMcqBankView tree={ctx.tree} subject={subject} />;
  }

  return (
    <ProfSessionCategoryPage
      tree={ctx.tree}
      subject={subject}
      categoryId={categoryId}
    />
  );
}
