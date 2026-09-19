import Link from "next/link";

/**
 * Developer credit for MedDesk.pk.
 * MedDesk logo file was not found in public/ — text credit only until
 * an official asset (e.g. public/meddesk-logo.png) is supplied.
 */
export function BrandCredit({
  tone = "muted",
  className = "",
}: {
  tone?: "muted" | "sidebar" | "auth";
  className?: string;
}) {
  const toneClass =
    tone === "sidebar"
      ? "text-sidebar-foreground/45 hover:text-sidebar-foreground/70"
      : tone === "auth"
        ? "text-white/45 hover:text-white/70"
        : "text-muted-foreground hover:text-foreground/80";

  return (
    <p
      className={`text-[11px] leading-relaxed tracking-wide ${toneClass} ${className}`}
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
