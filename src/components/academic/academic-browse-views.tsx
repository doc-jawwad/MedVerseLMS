import Link from "next/link";
import { Lock } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { EmptyState } from "@/components/student/empty-state";
import { AcademicBreadcrumbs } from "@/components/academic/academic-breadcrumbs";
import {
  BLOCK_CHROME_GROUPS,
  BLOCK_PRODUCT_DEFS,
  CLASS_DISPLAY_BY_YEAR_NUMBER,
  OSPE_GROUP_CATEGORY_IDS,
  OSPE_PRACTICE_HREF,
  PROF_SESSION_CHROME_GROUPS,
  PROF_SESSION_LABEL,
  PROF_SESSION_MCQ_BANK_SLUG,
  PROF_SESSION_OSPE_GROUP_CATEGORY_IDS,
  TEST_DAY_SLOTS,
  ACADEMIC_BASE_PATH,
  blockHref,
  buildAcademicBreadcrumbs,
  categoryHref,
  categorySlugFromId,
  dayHref,
  daySlotHref,
  findProfSessionCategoryById,
  profSessionCategoryHref,
  profSessionHref,
  profSessionSubjectHref,
  type AcademicProfSessionSubject,
  type AcademicTree,
  type AcademicTreeFolder,
  type AcademicTreeSubject,
} from "@/lib/academic-tree";

const OSPE_IDS = new Set<string>(OSPE_GROUP_CATEGORY_IDS);
const PS_OSPE_IDS = new Set<string>(PROF_SESSION_OSPE_GROUP_CATEGORY_IDS);

function TreeLinkCard({
  href,
  title,
  description,
  locked,
}: {
  href: string;
  title: string;
  description?: string;
  locked?: boolean;
}) {
  const body = (
    <Card
      className={`surface-card h-full gap-0 border-border/80 py-0 shadow-none transition-colors ${
        locked ? "opacity-90" : "hover:border-[var(--brand-teal)]/40 hover:bg-accent/30"
      }`}
    >
      <CardHeader className="gap-2 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-heading text-base font-semibold text-[var(--student-ink)]">
            {title}
          </CardTitle>
          {locked ? (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Locked"
            />
          ) : null}
        </div>
        <div className="brand-rule" aria-hidden />
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
    </Card>
  );

  return locked ? <div>{body}</div> : <Link href={href}>{body}</Link>;
}

export function AcademicHomeView({
  yearNumber,
  yearName,
}: {
  yearNumber: number;
  yearName?: string;
}) {
  const title =
    CLASS_DISPLAY_BY_YEAR_NUMBER[yearNumber] ??
    yearName ??
    `Year ${yearNumber}`;
  const blocks = BLOCK_PRODUCT_DEFS.filter((b) => b.year_number === yearNumber);
  const crumbs = buildAcademicBreadcrumbs({
    yearName: title,
    yearNumber,
  });

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title="Academic"
        description={`Blocks and subjects for ${title}. Individual items stay locked until your academy unlocks them or you subscribe. Prof. Session requires a subscription.`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {blocks.map((block) => (
          <TreeLinkCard
            key={block.key}
            href={blockHref(block.key)}
            title={block.name}
          />
        ))}
      </div>
      {blocks.length === 0 ? (
        <EmptyState
          title="No Blocks for your class yet"
          description="When your academy publishes Blocks for your year, they appear here."
        />
      ) : null}
    </StudentPage>
  );
}

export function ClassHomeView({
  tree,
  error,
}: {
  tree: AcademicTree;
  error?: string | null;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    yearNumber: tree.year_number,
  });

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={tree.year_name}
        description="Open any Block or Final-Year subject. Categories stay visible; item access follows entitlement."
        actions={
          <Link
            href={ACADEMIC_BASE_PATH}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Academic home
          </Link>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tree.subjects.map((subject) => (
          <TreeLinkCard
            key={subject.product_key}
            href={blockHref(subject.product_key)}
            title={subject.name}
          />
        ))}
      </div>
      {tree.subjects.length === 0 ? (
        <EmptyState
          title="No Blocks for this class yet"
          description="When your academy publishes Blocks for this year, they appear here."
        />
      ) : null}
    </StudentPage>
  );
}

export function BlockHomeView({
  tree,
  subject,
}: {
  tree: AcademicTree;
  subject: AcademicTreeSubject;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    yearNumber: tree.year_number,
    blockName: subject.name,
    blockSlug: subject.product_key,
  });

  const flatCategories = subject.categories.filter((c) => !OSPE_IDS.has(c.id));
  const ospeGroup = BLOCK_CHROME_GROUPS.find((g) => g.id === "ospe");

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={subject.name}
        description="Study categories for this Block or Final Year subject. Notes and Syllabus use the secure PDF reader. OSPE Material, Lectures, and Practice sit under OSPE. Prof. Session lives separately in the sidebar."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {flatCategories.map((category) => (
          <TreeLinkCard
            key={category.id}
            href={categoryHref(
              subject.product_key,
              categorySlugFromId(category.id)
            )}
            title={category.name}
          />
        ))}
      </div>
      {ospeGroup ? (
        <section className="mt-8 overflow-hidden rounded-xl border border-border/80 surface-card">
          <div className="border-b border-border/80 bg-[color-mix(in_srgb,var(--brand-navy)_5%,var(--student-surface))] px-4 py-3.5">
            <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
              {ospeGroup.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {ospeGroup.description}
            </p>
            <div className="brand-rule mt-2.5" aria-hidden />
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {ospeGroup.children.map((child) => {
              const href =
                child.href ??
                (child.categorySlug
                  ? categoryHref(subject.product_key, child.categorySlug)
                  : ACADEMIC_BASE_PATH);
              return (
                <TreeLinkCard
                  key={child.id}
                  href={href}
                  title={child.name}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </StudentPage>
  );
}

export function ProfSessionHomeView({ tree }: { tree: AcademicTree }) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
  });
  const subjects = tree.prof_session.subjects;

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={PROF_SESSION_LABEL}
        description={`${tree.year_name} — Blocks and Final-Year subjects with syllabus, schedule, materials, OSPE, and day-scoped MCQ Bank.`}
      />
      {subjects.length === 0 ? (
        <EmptyState
          title="No Prof. Session subjects yet"
          description="Subjects appear here for your enrolled class when your academy publishes them."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <TreeLinkCard
              key={subject.product_key}
              href={profSessionSubjectHref(subject.product_key)}
              title={subject.name}
              description={
                subject.days.length > 0
                  ? `${subject.days.length} published day${subject.days.length === 1 ? "" : "s"}`
                  : "No published days yet"
              }
            />
          ))}
        </div>
      )}
    </StudentPage>
  );
}

export function ProfSessionSubjectView({
  tree,
  subject,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
  });

  const flatCategories = subject.categories.filter(
    (c) => c.id !== "mcq_bank" && !PS_OSPE_IDS.has(c.id)
  );
  const ospeGroup = PROF_SESSION_CHROME_GROUPS.find((g) => g.id === "ospe");
  const mcqBank = findProfSessionCategoryById("mcq_bank");

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={subject.name}
        description={`${PROF_SESSION_LABEL} resources for this subject. Day-scoped MCQ Bank is separate from Academic Block practice.`}
        actions={
          <Link
            href={profSessionHref()}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            All subjects
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {flatCategories.map((category) => {
          const def = findProfSessionCategoryById(category.id);
          if (!def) return null;
          return (
            <TreeLinkCard
              key={category.id}
              href={profSessionCategoryHref(subject.product_key, def.slug)}
              title={category.name}
              description={def.description}
            />
          );
        })}
        {mcqBank ? (
          <TreeLinkCard
            href={profSessionCategoryHref(
              subject.product_key,
              PROF_SESSION_MCQ_BANK_SLUG
            )}
            title={mcqBank.name}
            description={
              subject.days.length > 0
                ? `${subject.days.length} day${subject.days.length === 1 ? "" : "s"}`
                : mcqBank.description
            }
          />
        ) : null}
      </div>
      {ospeGroup ? (
        <section className="mt-8 overflow-hidden rounded-xl border border-border/80 surface-card">
          <div className="border-b border-border/80 bg-[color-mix(in_srgb,var(--brand-navy)_5%,var(--student-surface))] px-4 py-3.5">
            <h2 className="font-heading text-lg font-semibold text-[var(--student-ink)]">
              {ospeGroup.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {ospeGroup.description}
            </p>
            <div className="brand-rule mt-2.5" aria-hidden />
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {ospeGroup.children.map((child) => {
              const href =
                "href" in child && child.href
                  ? child.href
                  : child.categorySlug
                    ? profSessionCategoryHref(
                        subject.product_key,
                        child.categorySlug
                      )
                    : OSPE_PRACTICE_HREF;
              const practiceHref =
                child.id === "ospe_practice" &&
                !subject.subject_id.startsWith("product:")
                  ? `${OSPE_PRACTICE_HREF}?subject=${encodeURIComponent(subject.subject_id)}`
                  : href;
              return (
                <TreeLinkCard
                  key={child.id}
                  href={practiceHref}
                  title={child.name}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </StudentPage>
  );
}

export function ProfSessionMcqBankView({
  tree,
  subject,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: "MCQ Bank",
    categorySlug: PROF_SESSION_MCQ_BANK_SLUG,
  });
  const days = subject.days;

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title="MCQ Bank"
        description={`Admin-created days for ${subject.name}. Each day has Guidelines, LoS, Practice MCQs, Test MCQs, and One-Liners.`}
        actions={
          <Link
            href={profSessionSubjectHref(subject.product_key)}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to {subject.name}
          </Link>
        }
      />
      {days.length === 0 ? (
        <EmptyState
          title="No published days yet"
          description="Days appear here when your academy creates and publishes them for this subject."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((day) => (
            <TreeLinkCard
              key={day.id}
              href={dayHref(subject.product_key, day.slug)}
              title={day.name}
            />
          ))}
        </div>
      )}
    </StudentPage>
  );
}

export function ProfSessionDayView({
  tree,
  subject,
  day,
}: {
  tree: AcademicTree;
  subject: AcademicProfSessionSubject;
  day: AcademicTreeFolder;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
    blockName: subject.name,
    blockSlug: subject.product_key,
    categoryName: "MCQ Bank",
    categorySlug: PROF_SESSION_MCQ_BANK_SLUG,
    dayName: day.name,
    daySlug: day.slug,
  });

  const slots =
    day.children.length > 0
      ? day.children
      : TEST_DAY_SLOTS.map((slot) => ({
          id: `${day.id}:${slot.id}`,
          slug: slot.slug,
          name: slot.name,
          locked: day.locked,
          parent_id: day.id,
          children: [] as AcademicTreeFolder[],
          items: [],
          day_slot: slot.id,
        }));

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={day.name}
        description={`${PROF_SESSION_LABEL} day containers — Guidelines, LoS, practice, tests, and one-liners.`}
        actions={
          <Link
            href={profSessionCategoryHref(
              subject.product_key,
              PROF_SESSION_MCQ_BANK_SLUG
            )}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            All days
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot) => (
          <TreeLinkCard
            key={slot.id}
            href={daySlotHref(subject.product_key, day.slug, slot.slug)}
            title={slot.name}
          />
        ))}
      </div>
    </StudentPage>
  );
}
