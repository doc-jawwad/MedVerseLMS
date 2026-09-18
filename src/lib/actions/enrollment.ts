"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Admin-only enrollment actions. The RPCs re-check has_permission()
// and write audit_logs — this layer is just transport + revalidation.

/** RPC transport only. Admin LMS blocking must use setAccountStatus — not this. */
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
  return grantResourceAccess(studentId, "practice_subject", { subjectId });
}

export async function grantResourceAccess(
  studentId: string,
  grantType: "practice_subject" | "test" | "materials_folder",
  target: { subjectId?: string; testId?: string; folderId?: string }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_access", {
    p_student_id: studentId,
    p_grant_type: grantType,
    p_subject_id: target.subjectId ?? null,
    p_test_id: target.testId ?? null,
    p_folder_id: target.folderId ?? null,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function revokeGrant(grantId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_access", {
    p_grant_id: grantId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function getStudentAccess(studentId: string, yearId: string) {
  const supabase = await createClient();
  const [{ data: subjects }, { data: tests }, { data: folders }, { data: grants }, { data: restrictions }] =
    await Promise.all([
      supabase
        .from("subjects")
        .select("id, name")
        .eq("year_id", yearId)
        .order("name"),
      supabase
        .from("tests")
        .select("id, title")
        .eq("year_id", yearId)
        .order("title"),
      supabase
        .from("material_folders")
        .select("id, name")
        .eq("year_id", yearId)
        .order("name"),
      supabase
        .from("access_grants")
        .select("id, grant_type, subject_id, test_id, folder_id")
        .eq("student_id", studentId)
        .is("revoked_at", null),
      supabase
        .from("access_restrictions")
        .select("id, resource_kind, subject_id, test_id, folder_id")
        .eq("student_id", studentId)
        .is("revoked_at", null),
    ]);
  return {
    subjects: subjects ?? [],
    tests: tests ?? [],
    folders: folders ?? [],
    grants: grants ?? [],
    restrictions: restrictions ?? [],
  };
}

export async function promoteStudent(studentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("promote_student", {
    p_student_id: studentId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function restrictResourceAccess(
  studentId: string,
  resourceKind: "practice_subject" | "test" | "materials_folder",
  target: { subjectId?: string; testId?: string; folderId?: string }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restrict_access", {
    p_student_id: studentId,
    p_resource_kind: resourceKind,
    p_subject_id: target.subjectId ?? null,
    p_test_id: target.testId ?? null,
    p_folder_id: target.folderId ?? null,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function unrestrictResourceAccess(restrictionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unrestrict_access", {
    p_restriction_id: restrictionId,
  });
  revalidatePath("/admin/students");
  return { error: error?.message };
}

export async function setResourceEntitlement(
  kind: "practice_subject" | "test" | "materials_folder",
  id: string,
  entitlement: "free" | "any_subscription" | "plan",
  requiredPlanId?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_resource_entitlement", {
    p_kind: kind,
    p_id: id,
    p_entitlement: entitlement,
    p_required_plan_id: requiredPlanId ?? null,
  });
  revalidatePath("/admin/students");
  revalidatePath("/admin/materials");
  revalidatePath("/admin/tests");
  revalidatePath("/materials");
  revalidatePath("/practice");
  revalidatePath("/tests");
  return { error: error?.message };
}
