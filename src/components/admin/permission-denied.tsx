export function AdminPermissionDenied({
  title = "Permission required",
  message = "You do not have permission to view this page.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
