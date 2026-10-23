import { requireStudent } from "@/lib/auth/require-user";
import { AttemptClient } from "./attempt-client";
import { SectionLock } from "@/components/subscription/section-lock";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import {
  attemptPageHasExistingAttempt,
  attemptPageUsesLiveAccessGate,
  parseAttemptNo,
} from "@/lib/tests/attempt-access-gate";
import { finalizeOwnExpiredAttempts } from "@/lib/tests/finalize-own-expired";

export const metadata = { title: "Exam — MedVerse LMS" };

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ attempt?: string | string[] }>;
}) {
  const { supabase, userId } = await requireStudent();
  const { id } = await params;
  const attemptNo = parseAttemptNo((await searchParams).attempt);
  await finalizeOwnExpiredAttempts(supabase);

  // A student may hold several attempts on a multi-attempt test.
  const { data: existingRows } = await supabase
    .from("test_attempts")
    .select("id, state")
    .eq("student_id", userId)
    .eq("test_id", id)
    .neq("state", "invalidated");
  const existing = attemptPageHasExistingAttempt(existingRows ?? [], attemptNo);

  const hasLiveAccess = await getStudentHasLiveSubscription();

  // New starts: live subscription / grant UX gate. Existing in_progress (resume
  // after paid expiry) and submitted history skip it — start_attempt decides.
  if (
    attemptPageUsesLiveAccessGate(Boolean(existing)) &&
    !studentHasPaidLmsSections(hasLiveAccess)
  ) {
    const { data: accessible } = await supabase.rpc("accessible_test_ids");
    const allowed = (accessible ?? []).some(
      (row: { id: string }) => row.id === id
    );
    if (!allowed) {
      return (
        <SectionLock
          title="Tests"
          description="This test requires a live subscription. Free and granted tests stay under Free Resources."
        />
      );
    }
  }

  return <AttemptClient testId={id} attemptNo={attemptNo} />;
}
