export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="section-eyebrow font-heading">{title}</h2>
        <div className="brand-rule mt-2" aria-hidden />
      </div>
      {description ? (
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
