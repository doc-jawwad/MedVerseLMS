import { requireStudent } from "@/lib/auth/require-user";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";
import { signOutAction } from "@/lib/actions/auth";
import { SessionWatch } from "@/components/session-watch";
import { StudentShellChrome } from "@/components/student/student-shell-chrome";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { buildStudentShellNav } from "@/lib/subscriptions/student-section-access";
import {
  bindSsrTiming,
  scheduleSsrTimingFlush,
} from "@/lib/observability/ssr-timing-rsc";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await bindSsrTiming();
  scheduleSsrTimingFlush();
  const { profile, enrollment, userId } = await requireStudent();
  const isBlockedExamContinue = isBlockedAccountStatus(profile.account_status);

  // Blocked accounts with leave_in_progress may only see the exam player —
  // never the student shell nav (dashboard / payments / year-change, etc.).
  if (isBlockedExamContinue) {
    return (
      <div className="min-h-svh bg-[var(--student-canvas)]">
        <SessionWatch userId={userId} />
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }

  const hasLiveAccess = await getStudentHasLiveSubscription();
  const { items: nav, bottomItems } = buildStudentShellNav(hasLiveAccess, {
    year_number: enrollment.year_number,
    year_name: enrollment.year_name,
  });
  const surface = hasLiveAccess ? "library" : "resources";

  return (
    <StudentShellChrome
      userId={userId}
      userLabel={profile.full_name}
      subLabel={enrollment.year_name}
      nav={nav}
      bottomItems={bottomItems}
      surface={surface}
      yearId={enrollment.year_id}
      yearNumber={enrollment.year_number}
      yearName={enrollment.year_name}
      hasLiveAccess={hasLiveAccess}
      signOutAction={signOutAction}
    >
      {children}
    </StudentShellChrome>
  );
}
