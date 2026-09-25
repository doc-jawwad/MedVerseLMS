"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConfirmDangerDialogProps = {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Destructive styling for permanent purge. */
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<{ error?: string } | void>;
  onSuccess?: () => void;
  /** When null, caller owns success toast. Default: standard success copy. */
  successMessage?: string | null;
};

/**
 * Explicit confirmation for Move to Bin / Permanent delete.
 * Destructive actions must not be one-click.
 */
export function ConfirmDangerDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled,
  onConfirm,
  onSuccess,
  successMessage,
}: ConfirmDangerDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{description}</div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending || disabled}
            onClick={() =>
              startTransition(async () => {
                const result = await onConfirm();
                if (result && "error" in result && result.error) {
                  toast.error(result.error);
                  return;
                }
                if (successMessage !== null) {
                  toast.success(
                    successMessage ??
                      (destructive ? "Permanently deleted" : "Moved to Bin")
                  );
                }
                setOpen(false);
                onSuccess?.();
              })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function purgeDateHint(from: Date = new Date()): string {
  const d = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
