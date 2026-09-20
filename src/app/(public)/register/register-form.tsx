"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signUp, type AuthResult } from "@/lib/actions/auth";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";

type Year = { id: string; year_number: number; name: string };

export function RegisterForm({ years }: { years: Year[] }) {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    signUp,
    undefined
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [collegeName, setCollegeName] = useState("");

  return (
    <Card className="w-full border-border/80 shadow-none">
      <CardHeader className="space-y-1.5 pb-4">
        <CardTitle className="text-xl text-[var(--brand-navy)]">
          Create your account
        </CardTitle>
        <CardDescription>
          Verify your email to start using the LMS right away. Free students can
          change class later; a subscription locks class to the purchased year.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              name="full_name"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-10"
            />
          </div>
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
          <div className="grid gap-2">
            <Label htmlFor="contact_number">Contact number</Label>
            <Input
              id="contact_number"
              name="contact_number"
              type="tel"
              required
              autoComplete="tel"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              className="h-10"
              placeholder="+92…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="college_name">College name</Label>
            <Input
              id="college_name"
              name="college_name"
              required
              value={collegeName}
              onChange={(e) => setCollegeName(e.target.value)}
              className="h-10"
              placeholder="Your medical college"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="year_id">Your MBBS year</Label>
            {years.length === 0 ? (
              <p className="text-sm text-destructive">
                Year list is unavailable. Please refresh or try again later.
              </p>
            ) : (
              <Select name="year_id" required>
                <SelectTrigger id="year_id" className="h-10 w-full">
                  <SelectValue placeholder="Select your year" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {years.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending || years.length === 0} className="h-10">
            {pending ? "Creating account…" : "Register"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link
              href="/login"
              className="font-medium text-[var(--brand-navy)] underline underline-offset-2"
            >
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
