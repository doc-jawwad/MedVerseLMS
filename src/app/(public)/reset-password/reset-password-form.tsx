"use client";

import { useActionState, useState } from "react";
import { updatePassword, type AuthResult } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    updatePassword,
    undefined
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-[var(--brand-navy)]">
          Choose a new password
        </CardTitle>
        <CardDescription>
          You followed a password reset link. Set a new password to finish.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              name="password"
              minLength={8}
              required
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              aria-invalid={Boolean(state?.error) || mismatch}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <PasswordInput
              id="confirm"
              name="confirm"
              minLength={8}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              aria-invalid={mismatch || Boolean(state?.error)}
            />
          </div>
          {mismatch && (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          )}
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            disabled={pending || mismatch || password.length < 8}
            className="h-10"
          >
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
