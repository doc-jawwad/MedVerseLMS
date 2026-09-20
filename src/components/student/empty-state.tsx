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
    <div className="rounded-xl border border-dashed bg-card/80 px-6 py-12 text-center">
      <p className="font-medium text-[var(--student-ink)]">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
