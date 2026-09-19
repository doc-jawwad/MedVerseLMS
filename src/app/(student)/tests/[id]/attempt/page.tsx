import { requireStudent } from "@/lib/auth/require-user";
import { AttemptClient } from "./attempt-client";
import { SectionLock } from "@/components/subscription/section-lock";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";

export const metadata = { title: "Exam — MedVerse LMS" };

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireStudent();
  const { id } = await params;
  const hasLiveAccess = await getStudentHasLiveSubscription();

  // Free / granted tests remain startable without paid LMS sections (Free Resources).
  // Paid tests without live access: polished lock (RPC would also deny start).
  if (!studentHasPaidLmsSections(hasLiveAccess)) {
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

  return <AttemptClient testId={id} />;
}
