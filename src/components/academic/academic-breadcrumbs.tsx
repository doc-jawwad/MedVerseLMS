import Link from "next/link";
import type { BreadcrumbCrumb } from "@/lib/academic-tree";

export function AcademicBreadcrumbs({
  crumbs,
}: {
  crumbs: BreadcrumbCrumb[];
}) {
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden className="text-muted-foreground/60">
                  /
                </span>
              ) : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-medium text-[var(--student-ink)]" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
