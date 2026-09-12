"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Admin-only enrollment actions. The RPCs themselves re-check is_admin()
// and write audit_logs — this layer is just transport + revalidation.

export async function setEnrollmentStatus(
  enrollmentId: string,
  status: "active" | "suspended" | "expired" | "revoked"
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_enrollment_status", {
    p_enrollment_id: enrollmentId,
    p_status: status,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function promoteStudent(studentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("promote_student", {
    p_student_id: studentId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}
