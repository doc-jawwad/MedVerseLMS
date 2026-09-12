"use client";

import { useActionState } from "react";
import { updatePassword, type AuthResult } from "@/lib/actions/auth";
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

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    updatePassword,
    undefined
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo dark className="mb-2" />
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          You followed a password reset link. Set a new password to finish.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
