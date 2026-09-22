export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.16em] text-[var(--brand-teal-ink)] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-[var(--student-ink)] sm:text-[1.85rem]">
          {title}
        </h1>
        <div className="brand-rule mt-2.5" aria-hidden />
        {description ? (
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
