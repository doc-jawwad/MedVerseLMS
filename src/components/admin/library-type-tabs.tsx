import Link from "next/link";
import { LIBRARY_LIST } from "@/lib/library/types";
import { cn } from "@/lib/utils";

export function AdminLibraryTypeTabs({
  basePath,
  active,
  extraParams,
  extras,
}: {
  basePath: string;
  active: string;
  extraParams?: string;
  extras?: { slug: string; label: string }[];
}) {
  const suffix = extraParams ? `&${extraParams}` : "";
  const tabs = [
    ...LIBRARY_LIST.map((t) => ({ slug: t.slug, label: t.label })),
    ...(extras ?? []),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const href = `${basePath}?type=${t.slug}${suffix}`;
        const on = active === t.slug;
        return (
          <Link
            key={t.slug}
            href={href}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
