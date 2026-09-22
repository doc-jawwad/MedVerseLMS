"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createSubscriptionPlan,
  updateSubscriptionPlan,
} from "@/lib/actions/subscriptions";
import { adminSubscriptionErrorMessage } from "@/lib/subscriptions/admin-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type YearOption = { id: string; year_name: string; year_number: number };

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  price: number;
  is_complimentary: boolean;
  is_active: boolean;
  sort_order: number;
  year_id: string;
  year_name?: string | null;
};

type FormState = {
  name: string;
  yearId: string;
  price: string;
  description: string;
  durationDays: string;
  sortOrder: string;
  isComplimentary: boolean;
  isActive: boolean;
};

export function PlanManager({
  plans,
  years,
  canManage,
  filterYearId,
}: {
  plans: PlanRow[];
  years: YearOption[];
  canManage: boolean;
  filterYearId?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<PlanRow | null>(null);

  function blankForm(yearId?: string): FormState {
    return {
      name: "",
      yearId: yearId ?? years[0]?.id ?? "",
      price: "0",
      description: "",
      durationDays: "365",
      sortOrder: String((plans.at(-1)?.sort_order ?? 0) + 10),
      isComplimentary: false,
      isActive: true,
    };
  }

  const [form, setForm] = useState<FormState>(() => blankForm(filterYearId ?? undefined));

  function openCreate() {
    setForm(blankForm(filterYearId ?? undefined));
    setCreateOpen(true);
  }

  function openEdit(p: PlanRow) {
    setEdit(p);
    setForm({
      name: p.name,
      yearId: p.year_id,
      price: String(p.price),
      description: p.description ?? "",
      durationDays: String(p.duration_days),
      sortOrder: String(p.sort_order),
      isComplimentary: p.is_complimentary,
      isActive: p.is_active,
    });
  }

  function submitCreate() {
    setCreateOpen(false);
    startTransition(async () => {
      const res = await createSubscriptionPlan({
        name: form.name.trim(),
        yearId: form.yearId,
        price: Number(form.price),
        description: form.description,
        durationDays: Number(form.durationDays),
        sortOrder: Number(form.sortOrder),
        isComplimentary: form.isComplimentary,
        isActive: form.isActive,
      });
      if ("error" in res && res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else toast.success("Plan created");
    });
  }

  function submitEdit() {
    if (!edit) return;
    const id = edit.id;
    setEdit(null);
    startTransition(async () => {
      const res = await updateSubscriptionPlan({
        planId: id,
        name: form.name.trim(),
        description: form.description,
        durationDays: Number(form.durationDays),
        sortOrder: Number(form.sortOrder),
        isComplimentary: form.isComplimentary,
        isActive: form.isActive,
        price: Number(form.price),
      });
      if (res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else toast.success("Plan updated");
    });
  }

  function toggleActive(p: PlanRow) {
    startTransition(async () => {
      const res = await updateSubscriptionPlan({
        planId: p.id,
        isActive: !p.is_active,
      });
      if (res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else toast.success(p.is_active ? "Plan deactivated" : "Plan activated");
    });
  }

  const visiblePlans = filterYearId
    ? plans.filter((p) => p.year_id === filterYearId)
    : plans;

  return (
    <div className="grid gap-4">
      {canManage && (
        <div>
          <Button type="button" onClick={openCreate} disabled={pending}>
            Create plan
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">Name</th>
              <th className="p-3">Class</th>
              <th className="p-3">Price</th>
              <th className="p-3">Days</th>
              <th className="p-3">Complimentary</th>
              <th className="p-3">Active</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlans.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="p-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground">
                      {p.description}
                    </div>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {p.year_name ?? years.find((y) => y.id === p.year_id)?.year_name ?? "—"}
                </td>
                <td className="p-3">
                  {p.is_complimentary ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span>{Number(p.price).toLocaleString()} PKR</span>
                  )}
                </td>
                <td className="p-3">{p.duration_days}</td>
                <td className="p-3">{p.is_complimentary ? "yes" : "no"}</td>
                <td className="p-3">{p.is_active ? "yes" : "no"}</td>
                <td className="p-3 text-right">
                  {canManage && (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => openEdit(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => toggleActive(p)}
                      >
                        {p.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visiblePlans.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-muted-foreground">
                  No plans yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create plan</DialogTitle>
          </DialogHeader>
          <PlanFields form={form} setForm={setForm} years={years} showYearSelector />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={!form.yearId || !form.name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit != null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit plan</DialogTitle>
          </DialogHeader>
          <PlanFields form={form} setForm={setForm} years={years} showYearSelector={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={submitEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanFields({
  form,
  setForm,
  years,
  showYearSelector,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  years: YearOption[];
  showYearSelector: boolean;
}) {
  return (
    <div className="grid gap-3">
      {showYearSelector && (
        <div className="grid gap-2">
          <Label htmlFor="plan-year">Class</Label>
          <Select
            value={form.yearId}
            onValueChange={(v) => setForm({ ...form, yearId: v })}
          >
            <SelectTrigger id="plan-year">
              <SelectValue placeholder="Select class…" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.year_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="plan-name">Name</Label>
        <Input
          id="plan-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="plan-desc">Description</Label>
        <Input
          id="plan-desc"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="plan-price">Price (PKR)</Label>
          <Input
            id="plan-price"
            type="number"
            min={0}
            step={100}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-days">Duration (days)</Label>
          <Input
            id="plan-days"
            type="number"
            min={1}
            value={form.durationDays}
            onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-order">Sort order</Label>
          <Input
            id="plan-order"
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="plan-comp">Complimentary</Label>
        <Switch
          id="plan-comp"
          checked={form.isComplimentary}
          onCheckedChange={(v) => setForm({ ...form, isComplimentary: v })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="plan-active">Active</Label>
        <Switch
          id="plan-active"
          checked={form.isActive}
          onCheckedChange={(v) => setForm({ ...form, isActive: v })}
        />
      </div>
    </div>
  );
}
