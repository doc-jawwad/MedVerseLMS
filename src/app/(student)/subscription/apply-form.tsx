"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createSubscriptionApplication,
  updatePendingSubscriptionApplication,
  uploadPaymentScreenshot,
} from "@/lib/actions/subscription-applications";
import {
  PAYMENT_SCREENSHOT_CONTENT_TYPES,
  PAYMENT_SCREENSHOT_MAX_BYTES,
  validatePaymentAmount,
  validatePaymentScreenshotFile,
} from "@/lib/payments/application";
import { studentSubscriptionErrorMessage } from "@/lib/subscriptions/student-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PaymentInstructions = {
  bank_name?: string | null;
  account_title?: string | null;
  account_number?: string | null;
  iban?: string | null;
  payment_instructions?: string | null;
  qr_reference?: string | null;
  currency?: string | null;
} | null;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InstructionRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium break-all sm:text-right">{value}</span>
    </div>
  );
}

export function SubscriptionApplyForm({
  instructions,
  instructionsError,
  mode,
  pendingApplicationId,
  initialAmount,
  currency = "PKR",
}: {
  instructions: PaymentInstructions;
  instructionsError?: string | null;
  mode: "create" | "edit";
  pendingApplicationId?: string | null;
  initialAmount?: number | null;
  currency?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(
    initialAmount != null ? String(initialAmount) : ""
  );
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">(
    "idle"
  );

  const displayCurrency =
    (instructions?.currency && instructions.currency.trim()) ||
    currency ||
    "PKR";

  function onFileChange(next: File | null) {
    setFile(next);
    setFileError(null);
    if (!next) return;
    const err = validatePaymentScreenshotFile({
      type: next.type,
      size: next.size,
    });
    if (err) {
      setFileError(studentSubscriptionErrorMessage(err));
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit() {
    setFormError(null);
    const amountErr = validatePaymentAmount(amount);
    if (amountErr) {
      setFormError(studentSubscriptionErrorMessage(amountErr));
      return;
    }
    const parsedAmount = Number(amount);
    if (mode === "create" && !file) {
      setFormError("Upload a payment screenshot before submitting.");
      return;
    }
    if (file) {
      const err = validatePaymentScreenshotFile({
        type: file.type,
        size: file.size,
      });
      if (err) {
        setFormError(studentSubscriptionErrorMessage(err));
        return;
      }
    }

    startTransition(async () => {
      try {
        let objectKey: string | undefined;
        if (file) {
          setPhase("uploading");
          const fd = new FormData();
          fd.set("file", file);
          const uploaded = await uploadPaymentScreenshot(fd);
          if (uploaded.error || !("objectKey" in uploaded)) {
            setFormError(
              studentSubscriptionErrorMessage(uploaded.error ?? "upload_failed")
            );
            setPhase("idle");
            return;
          }
          objectKey = uploaded.objectKey;
        }

        setPhase("submitting");
        if (mode === "edit" && pendingApplicationId) {
          const result = await updatePendingSubscriptionApplication({
            applicationId: pendingApplicationId,
            amount: parsedAmount,
            screenshotObjectKey: objectKey ?? null,
            currency: displayCurrency,
          });
          if (result.error) {
            setFormError(studentSubscriptionErrorMessage(result.error));
            setPhase("idle");
            return;
          }
          toast.success("Application updated. Waiting for admin review.");
        } else {
          if (!objectKey) {
            setFormError("Upload a payment screenshot before submitting.");
            setPhase("idle");
            return;
          }
          const result = await createSubscriptionApplication({
            amount: parsedAmount,
            screenshotObjectKey: objectKey,
            currency: displayCurrency,
          });
          if (result.error || !("id" in result)) {
            setFormError(
              studentSubscriptionErrorMessage(result.error ?? "create_failed")
            );
            setPhase("idle");
            return;
          }
          toast.success("Application submitted. Waiting for admin review.");
        }
        setPhase("idle");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch {
        setFormError(studentSubscriptionErrorMessage("network_error"));
        setPhase("idle");
      }
    });
  }

  const busy = pending || phase !== "idle";
  const accept = PAYMENT_SCREENSHOT_CONTENT_TYPES.join(",");

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-lg border p-4">
        <h2 className="font-medium">Payment instructions</h2>
        {instructionsError ? (
          <p className="text-sm text-destructive">
            {studentSubscriptionErrorMessage(instructionsError)}
          </p>
        ) : !instructions ? (
          <p className="text-sm text-muted-foreground">
            Payment instructions are not available yet. Contact your academy
            admin.
          </p>
        ) : (
          <div className="grid gap-2 text-sm">
            <InstructionRow label="Bank" value={instructions.bank_name} />
            <InstructionRow
              label="Account title"
              value={instructions.account_title}
            />
            <InstructionRow
              label="Account number"
              value={instructions.account_number}
            />
            <InstructionRow label="IBAN" value={instructions.iban} />
            <InstructionRow
              label="Currency"
              value={instructions.currency || "PKR"}
            />
            <InstructionRow
              label="QR / reference"
              value={instructions.qr_reference}
            />
            {instructions.payment_instructions?.trim() ? (
              <div className="grid gap-1 pt-2">
                <span className="text-muted-foreground">Instructions</span>
                <p className="whitespace-pre-wrap">
                  {instructions.payment_instructions}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="amount">Amount paid ({displayCurrency})</Label>
          <Input
            id="amount"
            inputMode="decimal"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="screenshot">
            Payment screenshot (JPEG, PNG, or WebP · max{" "}
            {formatBytes(PAYMENT_SCREENSHOT_MAX_BYTES)})
          </Label>
          <Input
            id="screenshot"
            ref={fileRef}
            type="file"
            accept={accept}
            disabled={busy}
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="text-sm text-muted-foreground">
              Selected: {file.name} ({formatBytes(file.size)})
            </p>
          )}
          {mode === "edit" && !file && (
            <p className="text-sm text-muted-foreground">
              Leave empty to keep the screenshot already on file.
            </p>
          )}
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
        </div>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button type="button" disabled={busy} onClick={submit} className="w-fit">
          {phase === "uploading"
            ? "Uploading screenshot…"
            : phase === "submitting"
              ? mode === "edit"
                ? "Updating…"
                : "Submitting…"
              : mode === "edit"
                ? "Update application"
                : "Submit for review"}
        </Button>
      </section>
    </div>
  );
}
