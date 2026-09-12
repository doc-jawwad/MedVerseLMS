"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  verifySignupCode,
  resendSignupCode,
  type AuthResult,
} from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";

export function VerifyEmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    verifySignupCode,
    undefined
  );
  const [resending, startResend] = useTransition();
  const [cooldown, setCooldown] = useState(false);

  function resend() {
    setCooldown(true);
    startResend(async () => {
      const res = await resendSignupCode(email);
      if (res.error) toast.error(res.error);
      else toast.success("A new code has been sent.");
      setTimeout(() => setCooldown(false), 10_000);
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo dark className="mb-2" />
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to
          confirm your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="email" value={email} />
          <div className="grid gap-2">
            <Label htmlFor="token">Verification code</Label>
            <Input
              id="token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              required
              className="text-center text-lg tracking-[0.5em]"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={resending || cooldown}
            onClick={resend}
          >
            {cooldown ? "Code sent — wait a moment…" : "Resend code"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
