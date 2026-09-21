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
  BLOCK_PRODUCT_DEFS,
  CLASS_DISPLAY_BY_YEAR_NUMBER,
  PROF_SESSION_LABEL,
  TEST_DAY_SLOTS,
  ACADEMIC_BASE_PATH,
  blockHref,
  buildAcademicBreadcrumbs,
  categoryHref,
  categorySlugFromId,
  dayHref,
  daySlotHref,
  profSessionHref,
  yearHref,
  type AcademicTree,
  type AcademicTreeFolder,
  type AcademicTreeSubject,
} from "@/lib/academic-tree";

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
      className={`h-full shadow-none transition-colors ${
        locked ? "opacity-90" : "hover:bg-accent/40"
      }`}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base text-[var(--student-ink)]">
            {title}
          </CardTitle>
          {locked ? (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Locked"
            />
          ) : null}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
    </Card>
  );

  return locked ? <div>{body}</div> : <Link href={href}>{body}</Link>;
}

export function AcademicHomeView() {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: "Academic",
  });

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title="Academic"
        description="Browse every MBBS class and Block. Individual items stay locked until your academy unlocks them or you subscribe. Prof. Session requires a subscription."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5].map((yearNumber) => (
          <TreeLinkCard
            key={yearNumber}
            href={yearHref(yearNumber)}
            title={CLASS_DISPLAY_BY_YEAR_NUMBER[yearNumber]!}
            description={`${BLOCK_PRODUCT_DEFS.filter((b) => b.year_number === yearNumber).length} Blocks / subjects`}
          />
        ))}
      </div>
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
            All classes
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

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={subject.name}
        description="Eight study categories for this Block. Prof. Session lives separately in the sidebar."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subject.categories.map((category) => (
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
    </StudentPage>
  );
}

export function ProfSessionHomeView({ tree }: { tree: AcademicTree }) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
  });
  const days = tree.prof_session.days;

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={PROF_SESSION_LABEL}
        description="Day-based syllabus, guidelines, one-liners, practice, and Test MCQ — separate from Block categories."
      />
      {days.length === 0 ? (
        <EmptyState
          title="No Prof. Session days yet"
          description="Days appear here when your academy publishes them."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((day) => (
            <TreeLinkCard
              key={day.id}
              href={dayHref(day.slug)}
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
  day,
}: {
  tree: AcademicTree;
  day: AcademicTreeFolder;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    yearName: tree.year_name,
    profSession: true,
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
        description={`${PROF_SESSION_LABEL} containers for this day.`}
        actions={
          <Link
            href={profSessionHref()}
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
            href={daySlotHref(day.slug, slot.slug)}
            title={slot.name}
          />
        ))}
      </div>
    </StudentPage>
  );
}
