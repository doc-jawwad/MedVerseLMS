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

export async function grantPracticeSubject(studentId: string, subjectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("access_grants").insert({
    student_id: studentId,
    grant_type: "practice_subject",
    subject_id: subjectId,
  });
  await supabase.rpc("log_audit", {
    p_action: "grant_practice_subject",
    p_target_type: "student",
    p_target_id: studentId,
    p_details: { subject_id: subjectId },
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function revokeGrant(grantId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("access_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null);
  await supabase.rpc("log_audit", {
    p_action: "revoke_grant",
    p_target_type: "access_grant",
    p_target_id: grantId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function getStudentAccess(studentId: string, yearId: string) {
  const supabase = await createClient();
  const [{ data: subjects }, { data: grants }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name")
      .eq("year_id", yearId)
      .order("name"),
    supabase
      .from("access_grants")
      .select("id, grant_type, subject_id")
      .eq("student_id", studentId)
      .is("revoked_at", null),
  ]);
  return { subjects: subjects ?? [], grants: grants ?? [] };
}

export async function promoteStudent(studentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("promote_student", {
    p_student_id: studentId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}
