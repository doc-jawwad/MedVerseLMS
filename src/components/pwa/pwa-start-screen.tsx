"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { BrandCredit } from "@/components/brand-credit";
import { PwaBootSplash } from "@/components/pwa/pwa-boot-splash";
import { createClient } from "@/lib/supabase/client";
import {
  PWA_START_SESSION_BUDGET_MS,
  raceWithTimeout,
} from "@/lib/pwa/startup-budget";

type Phase = "splash" | "landing";

/**
 * PWA start_url="/" entry.
 * Paints a local branded splash immediately, then decides session from the
 * browser client with a hard budget — never waits on profile/role RPCs here.
 * Authenticated users go to /dashboard; requireStudent redirects admins to /admin.
 */
export function PwaStartScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("splash");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const supabase = createClient();
        const raced = await raceWithTimeout(
          supabase.auth.getSession(),
          PWA_START_SESSION_BUDGET_MS
        );
        if (cancelled) return;

        if (!raced.timedOut && raced.value.data.session) {
          // Do not await profile/role — dashboard gates admins server-side.
          router.replace("/dashboard");
          return;
        }
      } catch {
        /* fall through to landing */
      }
      if (!cancelled) setPhase("landing");
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === "splash") {
    return <PwaBootSplash />;
  }

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-brand-strong text-brand-contrast">
      <div className="landing-atmosphere pointer-events-none absolute inset-0" />
      <header className="relative flex items-center justify-between px-6 py-5">
        <Logo size={32} />
        <div className="flex gap-2">
          <Button
            asChild
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Register</Link>
          </Button>
        </div>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="eyebrow-wide text-brand-ink">Medical education</p>
        <h1 className="mt-3 max-w-2xl font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          MedVerse LMS
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-white/70 sm:text-base">
          MedVerse LMS — Your All-in-One Medical Learning, Preparation, Testing
          &amp; Career Support Platform.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/register">Register</Link>
          </Button>
        </div>
        <BrandCredit
          tone="highlight"
          className="mt-8 text-center text-white [&_a]:text-brand [&_a]:hover:text-white"
        />
      </main>
    </div>
  );
}
