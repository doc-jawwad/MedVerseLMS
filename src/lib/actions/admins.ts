"use server";

import { createClient as createJsClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseFetch } from "@/lib/supabase/postgrest-fetch";
import {
  ADMIN_PERMISSION_CATALOG,
  type AdminPermissionCode,
} from "@/lib/admin/admin-rbac-ui";
import type { AccountStatusAction } from "@/lib/actions/account";

const ALLOWED = new Set(
  ADMIN_PERMISSION_CATALOG.map((p) => p.code)
);

function revalidateAdmins() {
  revalidatePath("/admin/admins");
  revalidatePath("/admin/students");
}

function createEphemeralAuthClient() {
  return createJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetch },
    }
  );
}

function sanitizeCodes(codes: string[]): AdminPermissionCode[] {
  return [...new Set(codes.filter((c) => ALLOWED.has(c as AdminPermissionCode)))] as AdminPermissionCode[];
}

async function requireManageAdmins() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_permission", {
    p_code: "manage_admins",
  });
  if (error || !data) {
    return { supabase, error: "permission_denied" as const };
  }
  return { supabase, error: null };
}

async function grantCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  adminId: string,
  codes: AdminPermissionCode[]
) {
  for (const code of codes) {
    const { error } = await supabase.rpc("grant_admin_permission", {
      p_admin_id: adminId,
      p_code: code,
    });
    if (error) return error.message;
  }
  return null;
}

export async function createAdminAccount(input: {
  email: string;
  fullName: string;
  password: string;
  codes: string[];
  makeMainAdmin: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const password = input.password;
  const codes = sanitizeCodes(input.codes);

  if (!email || !fullName || !password) {
    return { error: "Email, name, and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const gate = await requireManageAdmins();
  if (gate.error) return { error: gate.error };

  const adminApi = createAdminClient();
  const created = await adminApi.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user?.id) {
    return { error: created.error?.message ?? "Could not create the Auth user." };
  }
  const userId = created.data.user.id;

  const ephemeral = createEphemeralAuthClient();
  const signedIn = await ephemeral.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    await adminApi.auth.admin.deleteUser(userId);
    return { error: signedIn.error.message };
  }
  const ensured = await ephemeral.rpc("ensure_profile");
  await ephemeral.auth.signOut();
  if (ensured.error) {
    await adminApi.auth.admin.deleteUser(userId);
    return { error: ensured.error.message };
  }

  const promoted = await gate.supabase.rpc("set_admin_role", {
    p_user_id: userId,
    p_is_admin: true,
  });
  if (promoted.error) {
    revalidateAdmins();
    return { error: promoted.error.message };
  }

  if (input.makeMainAdmin) {
    const main = await gate.supabase.rpc("set_main_admin", {
      p_user_id: userId,
      p_is_main: true,
    });
    if (main.error) {
      revalidateAdmins();
      return { error: main.error.message };
    }
  } else {
    const grantError = await grantCodes(gate.supabase, userId, codes);
    if (grantError) {
      revalidateAdmins();
      return { error: grantError };
    }
  }

  revalidateAdmins();
  return { id: userId };
}

export async function promoteStudentToAdmin(input: {
  email: string;
  codes: string[];
  makeMainAdmin: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const codes = sanitizeCodes(input.codes);
  if (!email) return { error: "Email is required." };

  const gate = await requireManageAdmins();
  if (gate.error) return { error: gate.error };

  const { data: matches, error: lookupError } = await gate.supabase
    .from("profiles")
    .select("id, role, email")
    .ilike("email", email)
    .limit(3);
  if (lookupError) return { error: lookupError.message };
  const exact = (matches ?? []).filter(
    (p) => (p.email ?? "").toLowerCase() === email
  );
  if (exact.length === 0) return { error: "profile not found" };
  if (exact.length > 1) {
    return { error: "More than one profile uses that email. Promote is not safe." };
  }
  const profile = exact[0];
  if (profile.role === "admin") {
    return { error: "That account is already an admin." };
  }

  const promoted = await gate.supabase.rpc("set_admin_role", {
    p_user_id: profile.id,
    p_is_admin: true,
  });
  if (promoted.error) return { error: promoted.error.message };

  if (input.makeMainAdmin) {
    const main = await gate.supabase.rpc("set_main_admin", {
      p_user_id: profile.id,
      p_is_main: true,
    });
    if (main.error) {
      revalidateAdmins();
      return { error: main.error.message };
    }
  } else {
    const grantError = await grantCodes(gate.supabase, profile.id, codes);
    if (grantError) {
      revalidateAdmins();
      return { error: grantError };
    }
  }

  revalidateAdmins();
  return { id: profile.id };
}

export async function setAdminPermissions(
  adminId: string,
  codes: string[],
  makeMainAdmin: boolean
) {
  const next = sanitizeCodes(codes);
  const gate = await requireManageAdmins();
  if (gate.error) return { error: gate.error };

  const { data: profile, error: profileError } = await gate.supabase
    .from("profiles")
    .select("id, role, is_main_admin")
    .eq("id", adminId)
    .maybeSingle();
  if (profileError) return { error: profileError.message };
  if (!profile || profile.role !== "admin") {
    return { error: "target is not an admin" };
  }

  if (makeMainAdmin) {
    if (!profile.is_main_admin) {
      const main = await gate.supabase.rpc("set_main_admin", {
        p_user_id: adminId,
        p_is_main: true,
      });
      if (main.error) return { error: main.error.message };
    }
    revalidateAdmins();
    return { error: undefined };
  }

  if (!makeMainAdmin && profile.is_main_admin) {
    const main = await gate.supabase.rpc("set_main_admin", {
      p_user_id: adminId,
      p_is_main: false,
    });
    if (main.error) return { error: main.error.message };
  }

  const { data: currentRows, error: currentError } = await gate.supabase
    .from("admin_permissions")
    .select("permission_code")
    .eq("admin_id", adminId);
  if (currentError) return { error: currentError.message };

  const current = new Set(
    (currentRows ?? []).map((r) => r.permission_code as string)
  );
  const desired = new Set(next);

  for (const code of desired) {
    if (!current.has(code)) {
      const { error } = await gate.supabase.rpc("grant_admin_permission", {
        p_admin_id: adminId,
        p_code: code,
      });
      if (error) return { error: error.message };
    }
  }
  for (const code of current) {
    if (!desired.has(code as AdminPermissionCode)) {
      const { error } = await gate.supabase.rpc("revoke_admin_permission", {
        p_admin_id: adminId,
        p_code: code,
      });
      if (error) return { error: error.message };
    }
  }

  revalidateAdmins();
  return { error: undefined };
}

export async function demoteAdmin(adminId: string) {
  const gate = await requireManageAdmins();
  if (gate.error) return { error: gate.error };
  const { error } = await gate.supabase.rpc("set_admin_role", {
    p_user_id: adminId,
    p_is_admin: false,
  });
  revalidateAdmins();
  return { error: error?.message };
}

export async function setAdminAccountStatus(
  adminId: string,
  status: AccountStatusAction
) {
  const gate = await requireManageAdmins();
  if (gate.error) return { error: gate.error };
  const { error } = await gate.supabase.rpc("set_account_status", {
    p_student_id: adminId,
    p_status: status,
    p_attempt_disposition: null,
    p_reason: null,
  });
  revalidateAdmins();
  return { error: error?.message };
}
