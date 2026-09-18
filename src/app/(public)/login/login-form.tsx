"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, type AuthResult } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
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

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    signIn,
    undefined
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Logo dark className="mb-2" />
        <CardTitle>Sign in</CardTitle>
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
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            New student?{" "}
            <Link href="/register" className="underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
