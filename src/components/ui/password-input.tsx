"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

export function PasswordInput({
  id,
  name,
  autoComplete,
  required,
  minLength,
  defaultValue,
  value,
  onChange,
  className,
  "aria-invalid": ariaInvalid,
}: {
  id: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  "aria-invalid"?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const controlled = value !== undefined;

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        defaultValue={controlled ? undefined : defaultValue}
        value={controlled ? value : undefined}
        onChange={
          controlled
            ? (e) => onChange?.(e.target.value)
            : undefined
        }
        aria-invalid={ariaInvalid}
        className={cn("h-10 pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
