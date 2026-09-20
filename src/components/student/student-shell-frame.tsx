"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isExamLikePath } from "@/lib/pwa/install";

/**
 * Isolates the formal exam / preview player from student shell chrome.
 * Reuses the same path rule as ExamPwaGuard / PWA install hiding
 * (`isExamLikePath`) — no parallel exam-active mechanism.
 */
export function StudentShellFrame({
  shell,
  children,
}: {
  /** Full student chrome (sidebar + mobile nav + padded main). */
  shell: (main: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (isExamLikePath(pathname)) {
    return (
      <div className="min-h-svh bg-[var(--student-canvas)]">
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }
  return <>{shell(children)}</>;
}
