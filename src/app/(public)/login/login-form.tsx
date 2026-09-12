"use client";

import { useActionState } from "react";
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

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    signIn,
    undefined
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>MedVerse LMS</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
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
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
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
