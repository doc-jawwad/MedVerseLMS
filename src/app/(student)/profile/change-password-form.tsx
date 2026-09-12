"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { changePassword, type AuthResult } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<AuthResult | undefined, FormData>(
    async (prev, formData) => {
      const res = await changePassword(prev, formData);
      return res;
    },
    undefined
  );

  useEffect(() => {
    if (state && !state.error) {
      toast.success("Password updated.");
    }
  }, [state]);

  return (
    <form action={action} className="grid max-w-sm gap-4">
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
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          minLength={8}
          required
          autoComplete="new-password"
        />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Update password"}
      </Button>
    </form>
  );
}
