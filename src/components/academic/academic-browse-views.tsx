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
  PROF_SESSION_LABEL,
  TEST_DAY_SLOTS,
  blockHref,
  buildAcademicBreadcrumbs,
  categoryHref,
  categorySlugFromId,
  dayHref,
  daySlotHref,
  profSessionHref,
  type AcademicTree,
  type AcademicTreeFolder,
  type AcademicTreeSubject,
  type AcademicTreeSurface,
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
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Locked" />
          ) : null}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
    </Card>
  );

  return locked ? <div>{body}</div> : <Link href={href}>{body}</Link>;
}

export function ClassHomeView({
  surface,
  tree,
  error,
}: {
  surface: AcademicTreeSurface;
  tree: AcademicTree;
  error?: string | null;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    surface,
    yearName: tree.year_name,
  });

  return (
    <StudentPage>
      <AcademicBreadcrumbs crumbs={crumbs} />
      <PageHeader
        title={tree.year_name}
        description={
          surface === "resources"
            ? "Browse your class Blocks. Locked items stay locked until your academy unlocks them or you subscribe."
            : "Your subscribed class library — Blocks and categories for this year."
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tree.subjects.map((subject) => (
          <TreeLinkCard
            key={subject.product_key}
            href={blockHref(surface, subject.product_key)}
            title={subject.name}
            locked={subject.locked}
          />
        ))}
      </div>
      {tree.subjects.length === 0 ? (
        <EmptyState
          title="No Blocks for this class yet"
          description="When your academy publishes Blocks for your year, they appear here."
        />
      ) : null}
    </StudentPage>
  );
}

export function BlockHomeView({
  surface,
  tree,
  subject,
}: {
  surface: AcademicTreeSurface;
  tree: AcademicTree;
  subject: AcademicTreeSubject;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    surface,
    yearName: tree.year_name,
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
              surface,
              subject.product_key,
              categorySlugFromId(category.id)
            )}
            title={category.name}
            locked={category.locked || subject.locked}
          />
        ))}
      </div>
    </StudentPage>
  );
}

export function ProfSessionHomeView({
  surface,
  tree,
}: {
  surface: AcademicTreeSurface;
  tree: AcademicTree;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    surface,
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
              href={dayHref(surface, day.slug)}
              title={day.name}
              locked={day.locked || tree.prof_session.locked}
            />
          ))}
        </div>
      )}
    </StudentPage>
  );
}

export function ProfSessionDayView({
  surface,
  tree,
  day,
}: {
  surface: AcademicTreeSurface;
  tree: AcademicTree;
  day: AcademicTreeFolder;
}) {
  const crumbs = buildAcademicBreadcrumbs({
    surface,
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
            href={profSessionHref(surface)}
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
            href={daySlotHref(surface, day.slug, slot.slug)}
            title={slot.name}
            locked={slot.locked || day.locked || tree.prof_session.locked}
          />
        ))}
      </div>
    </StudentPage>
  );
}
