"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEGMENTED_MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function useClientMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/**
 * Theme control.
 * - `variant="segmented"`: Light / Dark / System (sidebar / account pages).
 * - `variant="icon"`: compact Sun/Moon only (header). System remains supported
 *   internally via next-themes; the visible control switches Light ↔ Dark.
 */
export function ThemeToggle({
  className,
  compact = false,
  tone = "sidebar",
  variant = "segmented",
}: {
  className?: string;
  compact?: boolean;
  /** sidebar: navy chrome; content: card/border tokens for account pages */
  tone?: "sidebar" | "content";
  variant?: "segmented" | "icon";
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useClientMounted();

  const shell =
    tone === "sidebar"
      ? {
          frame: "border-sidebar-border",
          idle: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          active: "bg-sidebar-accent text-sidebar-accent-foreground",
        }
      : {
          frame: "border-border bg-card text-[var(--student-ink)]",
          idle: "text-[var(--student-ink)]/75 hover:bg-accent hover:text-[var(--student-ink)]",
          active: "bg-primary text-primary-foreground",
        };

  if (!mounted) {
    return (
      <div
        className={cn(
          "rounded-lg border bg-transparent",
          shell.frame,
          variant === "icon"
            ? "h-9 w-[4.5rem]"
            : compact
              ? "h-9 w-9"
              : "h-9 w-full",
          className
        )}
        aria-hidden
      />
    );
  }

  if (variant === "icon") {
    const current = resolvedTheme === "dark" ? "dark" : "light";
    return (
      <div
        role="group"
        aria-label="Color theme"
        data-testid="theme-toggle"
        className={cn(
          "flex items-center gap-0.5 rounded-lg border p-0.5",
          shell.frame,
          className
        )}
      >
        {(
          [
            { value: "light" as const, label: "Light", icon: Sun },
            { value: "dark" as const, label: "Dark", icon: Moon },
          ] as const
        ).map(({ value, label, icon: Icon }) => {
          const active = current === value;
          return (
            <Button
              key={value}
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "size-8 shrink-0",
                shell.idle,
                active && shell.active
              )}
              aria-pressed={active}
              aria-label={label}
              title={label}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-3.5" aria-hidden />
            </Button>
          );
        })}
      </div>
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
      {SEGMENTED_MODES.map(({ value, label, icon: Icon }) => {
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
