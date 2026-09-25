import Link from "next/link";
import { Button } from "@/components/ui/button";

export function MaterialOpenLink({
  materialId,
  kind,
  title,
  locked,
  className,
}: {
  materialId: string;
  kind: string;
  title: string;
  locked?: boolean;
  className?: string;
}) {
  if (locked) {
    return <span className={className ?? "font-medium"}>{title}</span>;
  }
  if (kind === "pdf" || kind === "guideline") {
    return (
      <Button asChild variant="link" className={className ?? "h-auto p-0 font-medium"}>
        <Link href={`/materials/${materialId}/read`}>{title}</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="link" className={className ?? "h-auto p-0 font-medium"}>
      <Link href={`/materials/${materialId}/watch`}>{title}</Link>
    </Button>
  );
}
