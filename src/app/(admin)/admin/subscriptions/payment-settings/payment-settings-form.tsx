"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { upsertPaymentSettings } from "@/lib/actions/subscription-applications";
import { adminSubscriptionErrorMessage } from "@/lib/subscriptions/admin-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type PaymentSettingsRow = {
  bank_name: string | null;
  account_title: string | null;
  account_number: string | null;
  iban: string | null;
  payment_instructions: string | null;
  qr_reference: string | null;
  currency: string | null;
  is_active: boolean | null;
  subscription_grace_days: number | null;
};

export function PaymentSettingsForm({
  initial,
  canManage,
}: {
  initial: PaymentSettingsRow | null;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    bankName: initial?.bank_name ?? "",
    accountTitle: initial?.account_title ?? "",
    accountNumber: initial?.account_number ?? "",
    iban: initial?.iban ?? "",
    paymentInstructions: initial?.payment_instructions ?? "",
    qrReference: initial?.qr_reference ?? "",
    currency: initial?.currency ?? "PKR",
    isActive: initial?.is_active ?? false,
    graceDays: String(initial?.subscription_grace_days ?? 0),
  });

  function save() {
    startTransition(async () => {
      const res = await upsertPaymentSettings({
        bankName: form.bankName,
        accountTitle: form.accountTitle,
        accountNumber: form.accountNumber,
        iban: form.iban,
        paymentInstructions: form.paymentInstructions,
        qrReference: form.qrReference,
        currency: form.currency || "PKR",
        isActive: form.isActive,
        subscriptionGraceDays: Number(form.graceDays) as 0 | 1 | 2,
      });
      if (res.error) toast.error(adminSubscriptionErrorMessage(res.error));
      else toast.success("Payment settings saved");
    });
  }

  return (
    <div className="grid max-w-xl gap-4">
      {(
        [
          ["bankName", "Bank name"],
          ["accountTitle", "Account title"],
          ["accountNumber", "Account number"],
          ["iban", "IBAN"],
          ["qrReference", "QR / reference"],
          ["currency", "Currency"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="grid gap-2">
          <Label htmlFor={key}>{label}</Label>
          <Input
            id={key}
            value={form[key]}
            disabled={!canManage || pending}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </div>
      ))}
      <div className="grid gap-2">
        <Label htmlFor="instructions">Payment instructions</Label>
        <textarea
          id="instructions"
          className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          value={form.paymentInstructions}
          disabled={!canManage || pending}
          onChange={(e) =>
            setForm({ ...form, paymentInstructions: e.target.value })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="active">Active (shown to students)</Label>
        <Switch
          id="active"
          checked={form.isActive}
          disabled={!canManage || pending}
          onCheckedChange={(v) => setForm({ ...form, isActive: v })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="graceDays">Subscription grace period</Label>
        <select
          id="graceDays"
          className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          value={form.graceDays}
          disabled={!canManage || pending}
          onChange={(e) => setForm({ ...form, graceDays: e.target.value })}
        >
          <option value="0">0 days (lock at end date)</option>
          <option value="1">1 day after end date</option>
          <option value="2">2 days after end date</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Copied onto new subscriptions. Paid resources stay available until
          this grace ends; the account is not blocked.
        </p>
      </div>
      {canManage ? (
        <Button type="button" disabled={pending} onClick={save} className="w-fit">
          {pending ? "Saving…" : "Save settings"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          View only — requires <code>manage_payment_settings</code>.
        </p>
      )}
    </div>
  );
}
