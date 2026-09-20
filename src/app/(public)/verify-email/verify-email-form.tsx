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
import { Alert, AlertDescription } from "@/components/ui/alert";

export function VerifyEmailForm({ email: initialEmail }: { email: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    verifySignupCode,
    undefined
  );
  const [resending, startResend] = useTransition();
  const [cooldown, setCooldown] = useState(false);

  function resend() {
    const target = email.trim();
    if (!target) {
      toast.error("Enter the email you registered with.");
      return;
    }
    setCooldown(true);
    startResend(async () => {
      const res = await resendSignupCode(target);
      if (res.error) toast.error(res.error);
      else toast.success("A new code has been sent.");
      setTimeout(() => setCooldown(false), 10_000);
    });
  }

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-foreground">
          Verify your email
        </CardTitle>
        <CardDescription>
          {initialEmail ? (
            <>
              We sent a 6-digit code to <strong>{initialEmail}</strong>. Enter it
              below to confirm your account and open the LMS.
            </>
          ) : (
            <>
              Enter the email you registered with and the 6-digit code we sent
              you.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
              readOnly={Boolean(initialEmail)}
            />
          </div>
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
              className="h-10 text-center text-lg tracking-[0.5em]"
            />
          </div>
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="h-10">
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
