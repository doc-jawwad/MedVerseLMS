import Link from "next/link";
import { LIBRARY_LIST } from "@/lib/library/types";
import { cn } from "@/lib/utils";

export function AdminLibraryTypeTabs({
  basePath,
  active,
  extraParams,
}: {
  basePath: string;
  active: string;
  extraParams?: string;
}) {
  const suffix = extraParams ? `&${extraParams}` : "";
  return (
    <div className="flex flex-wrap gap-2">
      {LIBRARY_LIST.map((t) => {
        const href = `${basePath}?type=${t.slug}${suffix}`;
        const on = active === t.slug;
        return (
          <Link
            key={t.id}
            href={href}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              on
                ? "border-[#072855] bg-[#072855] text-white"
                : "bg-card text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
