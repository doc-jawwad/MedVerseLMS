"use client";

import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { openMaterial } from "@/lib/actions/materials";
import { Button } from "@/components/ui/button";

export function OpenMaterialButton({
  materialId,
  children,
  className,
}: {
  materialId: string;
  children: ReactNode;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="link"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await openMaterial(materialId);
          if ("error" in result && result.error) {
            toast.error(result.error);
            return;
          }
          if ("url" in result && result.url) {
            window.open(result.url, "_blank", "noopener,noreferrer");
          }
        })
      }
    >
      {children}
    </Button>
  );
}
