"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setResourceEntitlement } from "@/lib/actions/enrollment";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EntitlementSelect({
  kind,
  id,
  value,
  disabled,
}: {
  kind: "practice_subject" | "test" | "materials_folder" | "pearl_point";
  id: string;
  value: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-1">
      <Label className="text-xs">Access</Label>
      <Select
        value={value}
        disabled={disabled || pending}
        onValueChange={(next) => {
          if (next === "plan") {
            toast.error("Plan-specific access is set from the student grants screen.");
            return;
          }
          startTransition(async () => {
            const { error } = await setResourceEntitlement(
              kind,
              id,
              next as "free" | "any_subscription"
            );
            if (error) toast.error(error);
            else toast.success("Access updated");
          });
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">Free (includes paid)</SelectItem>
          <SelectItem value="any_subscription">Paid subscription</SelectItem>
          {value === "plan" && <SelectItem value="plan">Specific plan</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  );
}
