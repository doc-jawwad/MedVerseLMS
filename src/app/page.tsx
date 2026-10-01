import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { BrandCredit } from "@/components/brand-credit";
import { redirectIfAuthenticated } from "@/lib/auth/redirect-if-authenticated";

export default async function Home() {
  await redirectIfAuthenticated();

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-[var(--brand-navy)] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 15% 0%, #05aea955, transparent 50%), radial-gradient(ellipse at 90% 80%, #05aea922, transparent 40%)",
        }}
      />
      <header className="relative flex items-center justify-between px-6 py-5">
        <Logo size={32} />
        <div className="flex gap-2">
          <Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Register</Link>
          </Button>
        </div>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--brand-teal-ink)] uppercase">
          Medical education
        </p>
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
          className="mt-8 text-center text-white [&_a]:text-[var(--brand-teal)] [&_a]:hover:text-white"
        />
      </main>
    </div>
  );
}
