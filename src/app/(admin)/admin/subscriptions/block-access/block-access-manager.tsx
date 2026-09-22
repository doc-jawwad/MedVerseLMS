"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setBlockFreeAccess } from "@/lib/actions/subscriptions";
import { adminSubscriptionErrorMessage } from "@/lib/subscriptions/admin-errors";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type SubjectRow = {
  id: string;
  name: string;
  product_key: string | null;
  free_access: boolean;
  year_id: string | null;
  year_name?: string | null;
};

export function BlockAccessManager({ subjects }: { subjects: SubjectRow[] }) {
  const [pending, startTransition] = useTransition();

  function toggle(subject: SubjectRow) {
    startTransition(async () => {
      const res = await setBlockFreeAccess(subject.id, !subject.free_access);
      if (res.error) {
        toast.error(adminSubscriptionErrorMessage(res.error));
      } else {
        toast.success(
          subject.free_access
            ? `${subject.name} locked for free students`
            : `${subject.name} opened for free students`
        );
      }
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Subject / Block</th>
            <th className="p-3">Class</th>
            <th className="p-3">Product key</th>
            <th className="p-3 text-right">Free access</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-3 font-medium">{s.name}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {s.year_name ?? "—"}
              </td>
              <td className="p-3">
                <code className="text-xs">{s.product_key}</code>
              </td>
              <td className="p-3">
                <div className="flex items-center justify-end gap-3">
                  {s.free_access && (
                    <Badge variant="secondary" className="text-xs">
                      open
                    </Badge>
                  )}
                  <Switch
                    checked={s.free_access}
                    onCheckedChange={() => toggle(s)}
                    disabled={pending}
                    aria-label={`Toggle free access for ${s.name}`}
                  />
                </div>
              </td>
            </tr>
          ))}
          {subjects.length === 0 && (
            <tr>
              <td colSpan={4} className="p-3 text-muted-foreground">
                No Block/Final Year subjects found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
