"use client";

import { usePathname } from "next/navigation";
import { setAdminClassAction } from "@/lib/actions/admin-class";
import { yearDisplayName } from "@/lib/library/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRef } from "react";

export type AdminYearOption = {
  id: string;
  year_number: number;
  name: string;
};

export function AdminClassSelector({
  years,
  selectedId,
}: {
  years: AdminYearOption[];
  selectedId: string | null;
}) {
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={setAdminClassAction}
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2"
    >
      <input type="hidden" name="next" value={pathname || "/admin/library"} />
      <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        Class
      </p>
      <Select
        value={selectedId ?? undefined}
        onValueChange={(v) => {
          const form = formRef.current;
          if (!form) return;
          const hidden = form.querySelector<HTMLInputElement>(
            'input[name="yearId"]'
          );
          if (hidden) hidden.value = v;
          form.requestSubmit();
        }}
      >
        <SelectTrigger className="h-9 min-w-48">
          <SelectValue placeholder="Select class / year" />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y.id} value={y.id}>
              {yearDisplayName(y)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="yearId" value={selectedId ?? ""} />
      {!selectedId && (
        <Button type="submit" size="sm" variant="secondary" disabled>
          Select a class first
        </Button>
      )}
    </form>
  );
}
