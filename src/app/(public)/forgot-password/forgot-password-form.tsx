"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { requestPasswordReset, type AuthResult } from "@/lib/actions/auth";
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

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    async (prev, formData) => {
      const res = await requestPasswordReset(prev, formData);
      if (!res.error) setSent(true);
      return res;
    },
    undefined
  );

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-[var(--brand-navy)]">
          Forgot password
        </CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a link to reset your
          password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <Alert>
            <AlertDescription>
              If an account exists with that email, a reset link is on its way.
              Check your inbox (and spam folder).
            </AlertDescription>
          </Alert>
        ) : (
          <form action={action} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </div>
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={pending} className="h-10">
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-[var(--brand-navy)] underline underline-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
