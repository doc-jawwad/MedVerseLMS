export function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <h2 className="font-heading text-[13px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h2>
      {description && (
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
