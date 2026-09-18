"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccountStatusAction =
  | "active"
  | "restricted"
  | "suspended"
  | "deactivated"
  | "revoked";

export type AttemptDisposition =
  | "leave_in_progress"
  | "invalidate"
  | "finalize";

// Transport for the documented set_account_status RPC. The RPC re-checks
// is_admin() and requires an explicit attempt disposition when a live exam
// exists. UI hiding is not authorization.
export async function setAccountStatus(
  studentId: string,
  status: AccountStatusAction,
  attemptDisposition?: AttemptDisposition,
  reason?: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_status", {
    p_student_id: studentId,
    p_status: status,
    p_attempt_disposition: attemptDisposition ?? null,
    p_reason: reason ?? null,
  });
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  return { error: error?.message };
}
