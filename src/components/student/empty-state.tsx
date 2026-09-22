export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/80 bg-card/70 px-6 py-12 text-center">
      <div className="mx-auto mb-3 brand-rule" aria-hidden />
      <p className="font-heading text-base font-semibold text-[var(--student-ink)]">
        {title}
      </p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
