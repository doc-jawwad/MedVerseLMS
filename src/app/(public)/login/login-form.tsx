"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, type AuthResult } from "@/lib/actions/auth";
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
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    signIn,
    undefined
  );
  // Keep email/password across failed submissions (session memory only — never localStorage).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-[var(--brand-navy)]">Sign in</CardTitle>
        <CardDescription>Access your MedVerse LMS account</CardDescription>
      </CardHeader>
      <CardContent>
        {reason === "kicked" && (
          <Alert className="mb-4">
            <AlertDescription>
              You were signed out because your account was signed in on another
              device. Only one active session is allowed.
            </AlertDescription>
          </Alert>
        )}
        {reason === "exists" && (
          <Alert className="mb-4">
            <AlertDescription>
              An account already exists with this email address. Please sign in
              or reset your password.
            </AlertDescription>
          </Alert>
        )}
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next ?? ""} />
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
              aria-invalid={Boolean(state?.error)}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              aria-invalid={Boolean(state?.error)}
            />
          </div>
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="h-10">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            New student?{" "}
            <Link href="/register" className="font-medium text-[var(--brand-navy)] underline underline-offset-2">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
