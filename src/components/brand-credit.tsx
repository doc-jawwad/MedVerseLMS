import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Developer credit for MedDesk.pk.
 * MedDesk logo file was not found in public/ — text credit only until
 * an official asset (e.g. public/meddesk-logo.png) is supplied.
 */
export function BrandCredit({
  tone = "muted",
  className = "",
}: {
  tone?: "muted" | "sidebar" | "auth" | "highlight";
  className?: string;
}) {
  if (tone === "highlight") {
    return (
      <p
        className={cn(
          "brand-credit-highlight text-sm leading-relaxed tracking-wide sm:text-base",
          className
        )}
        data-testid="brand-credit"
        data-tone="highlight"
      >
        A project of{" "}
        <Link
          href="https://meddesk.pk"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[var(--brand-teal-ink)] underline decoration-[var(--brand-teal)]/55 underline-offset-4 transition-colors hover:text-[var(--brand-teal)]"
        >
          MedDesk.pk
        </Link>
      </p>
    );
  }

  const toneClass =
    tone === "sidebar"
      ? "text-sidebar-foreground/45 hover:text-sidebar-foreground/70"
      : tone === "auth"
        ? "text-white/70 hover:text-white"
        : "text-muted-foreground hover:text-foreground/80";

  return (
    <p
      className={cn(
        "text-[11px] leading-relaxed tracking-wide",
        toneClass,
        className
      )}
      data-testid="brand-credit"
      data-tone={tone}
    >
      A project of{" "}
      <Link
        href="https://meddesk.pk"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        MedDesk.pk
      </Link>
    </p>
  );
}
