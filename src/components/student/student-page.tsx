import { cn } from "@/lib/utils";

export function StudentPage({
  children,
  className,
  width = "default",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "default" | "narrow" | "article";
}) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full gap-6",
        width === "narrow" && "max-w-2xl",
        width === "article" && "max-w-3xl",
        width === "default" && "max-w-6xl",
        className
      )}
    >
      {children}
    </div>
  );
}
