"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle({
  className,
  compact = false,
  tone = "sidebar",
}: {
  className?: string;
  compact?: boolean;
  /** sidebar: navy chrome; content: card/border tokens for account pages */
  tone?: "sidebar" | "content";
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const shell =
    tone === "sidebar"
      ? {
          frame: "border-sidebar-border",
          idle: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          active: "bg-sidebar-accent text-sidebar-accent-foreground",
        }
      : {
          frame: "border-border bg-card",
          idle: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          active: "bg-primary text-primary-foreground",
        };

  if (!mounted) {
    return (
      <div
        className={cn(
          "h-9 rounded-lg border bg-transparent",
          shell.frame,
          compact ? "w-9" : "w-full",
          className
        )}
        aria-hidden
      />
    );
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      data-testid="theme-toggle"
      className={cn(
        "flex items-center gap-1 rounded-lg border p-1",
        shell.frame,
        className
      )}
    >
      {MODES.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-7 gap-1.5 px-2 text-xs",
              shell.idle,
              active && shell.active
            )}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
          >
            <Icon className="size-3.5" aria-hidden />
            {!compact && <span>{label}</span>}
          </Button>
        );
      })}
    </div>
  );
}
