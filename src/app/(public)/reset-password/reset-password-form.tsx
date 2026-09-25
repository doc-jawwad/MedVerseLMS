"use client";

import { useActionState, useEffect, useState } from "react";
import { updatePassword, type AuthResult } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/client";
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
import Link from "next/link";

type Gate = "loading" | "ready" | "invalid";

export function ResetPasswordForm() {
  const [gate, setGate] = useState<Gate>("loading");
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    updatePassword,
    undefined
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function resolveSession() {
      // Browser client picks up recovery hash/code from the URL when present
      // (default Auth ConfirmationURL → /reset-password#… or ?code=).
      const first = await supabase.auth.getSession();
      if (cancelled) return;
      if (first.data.session) {
        setGate("ready");
        return;
      }
      // Brief wait for detectSessionInUrl / cookie hydration after /auth/confirm.
      await new Promise((r) => setTimeout(r, 100));
      if (cancelled) return;
      const second = await supabase.auth.getSession();
      if (cancelled) return;
      setGate(second.data.session ? "ready" : "invalid");
    }

    void resolveSession();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === "loading") {
    return (
      <Card className="w-full border-border/80 shadow-none">
        <CardHeader className="space-y-1.5 pb-4">
          <CardTitle className="text-xl text-foreground">
            Choose a new password
          </CardTitle>
          <CardDescription>Checking your reset link…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (gate === "invalid") {
    return (
      <Card className="w-full border-border/80 shadow-none">
        <CardHeader className="space-y-1.5 pb-4">
          <CardTitle className="text-xl text-foreground">
            Reset link invalid
          </CardTitle>
          <CardDescription>
            This password reset link is invalid or has expired. Request a new
            one and try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button asChild className="h-10">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="outline" className="h-10">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-foreground">
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
