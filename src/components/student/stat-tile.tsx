import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("shadow-none", className)}>
      <CardHeader className="gap-1 pb-1">
        <CardDescription className="text-[11px] font-medium tracking-wide uppercase">
          {label}
        </CardDescription>
        <CardTitle className="font-heading text-2xl font-semibold tracking-tight text-[#072855]">
          {value}
        </CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  );
}
