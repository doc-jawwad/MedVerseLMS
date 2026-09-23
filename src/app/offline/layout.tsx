import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = { title: "Offline — MedVerse LMS" };

/**
 * Minimal chrome for cold-start offline reading. No requireStudent — the
 * page must boot from the service-worker cache without network/auth RPCs.
 */
export default function OfflineShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-[var(--student-canvas,#f6f7f9)] text-foreground">
      <header className="border-b bg-card px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/offline" className="text-sm font-semibold tracking-tight">
            MedVerse Offline Library
          </Link>
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Back online
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
