import "server-only";

import { createClient } from "@/lib/supabase/server";
import { deriveClassLockState } from "@/lib/profile/class-lock";
import type {
  StudentProfilePort,
  SubscriptionClassPort,
  ProfileAdapterResult,
} from "@/lib/profile/ports";
import type {
  ClassLockState,
  ClassLockKind,
  ProfileUpdateInput,
  PurchaseClassConfirmation,
  StudentProfile,
  YearChangeRequestView,
  YearOption,
} from "@/lib/profile/types";
import {
  normalizeContactNumber,
  validateCollegeName,
  validateContactNumber,
  validateFullName,
  validatePurchaseClassConfirmation,
} from "@/lib/profile/validation";
import { getR2Config, presignR2Object, studyContentPrefix } from "@/lib/r2/presign";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Contact has no profiles column yet — Auth metadata bootstrap only. */
const META_CONTACT = "contact_number";
/** Compat bridge when college was stored before Data Spine profiles.college_name. */
const META_COLLEGE = "college_name";
/** Compat bridge for avatar before profiles.avatar_object_key reads. */
const META_AVATAR = "avatar_object_key";
/** Compat intent before create_subscription_application(p_year_id). */
const META_PURCHASE_YEAR = "subscription_purchase_year_id";

function metaString(
  meta: Record<string, unknown> | undefined,
  key: string
): string | null {
  const v = meta?.[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

async function currentUser(supabase: Supabase) {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

async function loadEnrollment(supabase: Supabase) {
  const { data } = await supabase
    .from("enrollments")
    .select("id, year_id, status, years(year_number, name)")
    .eq("status", "active")
    .maybeSingle();
  if (!data) {
    return {
      year_id: null as string | null,
      year_name: null as string | null,
      year_number: null as number | null,
      status: null as string | null,
    };
  }
  const years = data.years as unknown as
    | { year_number: number; name: string }
    | { year_number: number; name: string }[]
    | null;
  const y = Array.isArray(years) ? years[0] : years;
  return {
    year_id: data.year_id as string,
    year_name: y?.name ?? null,
    year_number: y?.year_number ?? null,
    status: data.status as string,
  };
}

async function yearNameById(
  supabase: Supabase,
  yearId: string | null | undefined
): Promise<string | null> {
  if (!yearId) return null;
  const { data } = await supabase
    .from("years")
    .select("name, year_number")
    .eq("id", yearId)
    .maybeSingle();
  if (!data) return null;
  if (data.year_number === 5) return "Final Year MBBS";
  return data.name;
}

function normalizeClassLockRpc(
  raw: Record<string, unknown>,
  names: {
    subscriptionYearName: string | null;
    pendingYearId: string | null;
    pendingYearName: string | null;
  }
): ClassLockState {
  const lockRaw = String(raw.lock ?? "free");
  const lock: ClassLockKind =
    lockRaw === "pending_application" || lockRaw === "active_subscription"
      ? lockRaw
      : "free";
  const canSelf =
    typeof raw.can_self_change === "boolean"
      ? raw.can_self_change
      : lock === "free";
  return {
    year_id: typeof raw.year_id === "string" ? raw.year_id : null,
    year_number:
      typeof raw.year_number === "number" ? raw.year_number : null,
    year_name: typeof raw.year_name === "string" ? raw.year_name : null,
    lock,
    can_self_change: canSelf,
    subscription_year_id:
      typeof raw.subscription_year_id === "string"
        ? raw.subscription_year_id
        : null,
    subscription_year_name: names.subscriptionYearName,
    pending_application_id:
      typeof raw.pending_application_id === "string"
        ? raw.pending_application_id
        : null,
    pending_application_year_id: names.pendingYearId,
    pending_application_year_name: names.pendingYearName,
  };
}

async function buildProfile(
  supabase: Supabase,
  userId: string
): Promise<StudentProfile | null> {
  const [{ data: row }, user, enrollment] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, college_name, avatar_object_key")
      .eq("id", userId)
      .maybeSingle(),
    currentUser(supabase),
    loadEnrollment(supabase),
  ]);
  if (!row) return null;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;

  const college =
    (typeof row.college_name === "string" && row.college_name.trim()
      ? row.college_name.trim()
      : null) ?? metaString(meta, META_COLLEGE);

  const avatarKey =
    (typeof row.avatar_object_key === "string" && row.avatar_object_key.trim()
      ? row.avatar_object_key.trim()
      : null) ?? metaString(meta, META_AVATAR);

  let avatarUrl: string | null = null;
  if (avatarKey) {
    const signed = presignR2Object({ method: "GET", key: avatarKey });
    if ("url" in signed) avatarUrl = signed.url;
  }

  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    contact_number: metaString(meta, META_CONTACT),
    college_name: college,
    avatar_object_key: avatarKey,
    avatar_url: avatarUrl,
    current_year_id: enrollment.year_id,
    current_year_name: enrollment.year_name,
    current_year_number: enrollment.year_number,
    enrollment_status: enrollment.status,
  };
}

async function mergeUserMetadata(
  supabase: Supabase,
  patch: Record<string, string | null>
): Promise<string | null> {
  const user = await currentUser(supabase);
  if (!user) return "not_authenticated";
  const next = { ...(user.user_metadata ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete next[k];
    else next[k] = v;
  }
  const { error } = await supabase.auth.updateUser({ data: next });
  if (error) return error.message;
  return null;
}

export function createStudentProfileAdapter(
  supabase?: Supabase
): StudentProfilePort {
  async function client() {
    return supabase ?? (await createClient());
  }

  return {
    async getOwnProfile() {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };
      const profile = await buildProfile(sb, user.id);
      if (!profile) return { ok: false, error: "profile_not_found" };
      return { ok: true, data: profile };
    },

    async updateOwnProfile(input: ProfileUpdateInput) {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };

      const current = await buildProfile(sb, user.id);
      if (!current) return { ok: false, error: "profile_not_found" };

      const fullName =
        input.full_name !== undefined
          ? String(input.full_name).trim()
          : current.full_name;
      const errName = validateFullName(fullName);
      if (errName) return { ok: false, error: errName };

      if (input.contact_number !== undefined && input.contact_number != null) {
        const err = validateContactNumber(input.contact_number);
        if (err) return { ok: false, error: err };
      }

      const collegeNext =
        input.college_name !== undefined
          ? input.college_name
            ? String(input.college_name).trim()
            : null
          : current.college_name;
      if (collegeNext) {
        const err = validateCollegeName(collegeNext);
        if (err) return { ok: false, error: err };
      }

      // Data Spine: name + college on profiles (no contact column).
      const { error: rpcError } = await sb.rpc("update_own_profile", {
        p_full_name: fullName,
        p_college_name: collegeNext,
      });

      if (rpcError && !rpcMissing(rpcError)) {
        return { ok: false, error: rpcError.message };
      }

      if (rpcError && rpcMissing(rpcError)) {
        const { error } = await sb
          .from("profiles")
          .update({ full_name: fullName })
          .eq("id", user.id);
        if (error) return { ok: false, error: error.message };
        const metaErr = await mergeUserMetadata(sb, {
          ...(input.college_name !== undefined
            ? { [META_COLLEGE]: collegeNext }
            : {}),
        });
        if (metaErr) return { ok: false, error: metaErr };
      }

      // Contact remains Auth metadata (no Data Spine column).
      if (input.contact_number !== undefined) {
        const metaErr = await mergeUserMetadata(sb, {
          [META_CONTACT]: input.contact_number
            ? normalizeContactNumber(input.contact_number)
            : null,
        });
        if (metaErr) return { ok: false, error: metaErr };
      }

      const profile = await buildProfile(sb, user.id);
      if (!profile) return { ok: false, error: "profile_not_found" };
      return { ok: true, data: profile };
    },

    async allocateAvatarUpload() {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };

      const { data, error } = await sb.rpc("allocate_avatar_object_key");
      if (error && !rpcMissing(error)) {
        return { ok: false, error: error.message };
      }
      if (error && rpcMissing(error)) {
        const config = getR2Config();
        if ("error" in config) {
          return { ok: false, error: "avatar_storage_unavailable" };
        }
        const objectKey = `${studyContentPrefix()}/avatars/${user.id}/${crypto.randomUUID()}`;
        const signed = presignR2Object({
          method: "PUT",
          key: objectKey,
          config,
        });
        if ("error" in signed) return { ok: false, error: signed.error };
        return { ok: true, data: { objectKey, uploadUrl: signed.url } };
      }
      if (typeof data !== "string" || !data) {
        return { ok: false, error: "avatar_object_denied" };
      }
      const signed = presignR2Object({ method: "PUT", key: data });
      return {
        ok: true,
        data: {
          objectKey: data,
          uploadUrl: "url" in signed ? signed.url : null,
        },
      };
    },

    async setAvatarObjectKey(objectKey: string) {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };
      if (
        !objectKey.startsWith(`${studyContentPrefix()}/`) ||
        objectKey.includes("..")
      ) {
        return { ok: false, error: "invalid_avatar_object_key" };
      }

      // authorize_avatar_object returns the stored key for signing (own profile).
      // allocate_avatar_object_key already persisted profiles.avatar_object_key.
      const { data: authorizedKey, error } = await sb.rpc(
        "authorize_avatar_object"
      );
      if (error && !rpcMissing(error)) {
        return { ok: false, error: error.message };
      }
      if (!error && typeof authorizedKey === "string") {
        if (authorizedKey !== objectKey) {
          return { ok: false, error: "avatar_object_mismatch" };
        }
      }

      // Compat: keep metadata in sync for older readers.
      const metaErr = await mergeUserMetadata(sb, { [META_AVATAR]: objectKey });
      if (metaErr) return { ok: false, error: metaErr };

      const profile = await buildProfile(sb, user.id);
      if (!profile) return { ok: false, error: "profile_not_found" };
      return { ok: true, data: profile };
    },

    async clearAvatar() {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };

      // No clear_avatar RPC — best-effort profiles column clear via RLS.
      const { error } = await sb
        .from("profiles")
        .update({ avatar_object_key: null })
        .eq("id", user.id);
      if (error && !rpcMissing(error)) {
        // Still clear metadata so UI drops the preview.
        await mergeUserMetadata(sb, { [META_AVATAR]: null });
        return { ok: false, error: error.message };
      }

      const metaErr = await mergeUserMetadata(sb, { [META_AVATAR]: null });
      if (metaErr) return { ok: false, error: metaErr };
      const profile = await buildProfile(sb, user.id);
      if (!profile) return { ok: false, error: "profile_not_found" };
      return { ok: true, data: profile };
    },
  };
}

export function createSubscriptionClassAdapter(
  supabase?: Supabase
): SubscriptionClassPort {
  async function client() {
    return supabase ?? (await createClient());
  }

  return {
    async getClassLockState(): Promise<ProfileAdapterResult<ClassLockState>> {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };

      const { data: rpcData, error: rpcError } = await sb.rpc(
        "get_class_lock_state"
      );
      if (!rpcError && rpcData && typeof rpcData === "object") {
        const row = rpcData as Record<string, unknown>;
        const subYearId =
          typeof row.subscription_year_id === "string"
            ? row.subscription_year_id
            : null;
        const pendingId =
          typeof row.pending_application_id === "string"
            ? row.pending_application_id
            : null;

        let pendingYearId: string | null = null;
        if (pendingId) {
          const { data: app } = await sb
            .from("subscription_applications")
            .select("year_id")
            .eq("id", pendingId)
            .maybeSingle();
          pendingYearId =
            typeof app?.year_id === "string" ? app.year_id : null;
        }

        const [subscriptionYearName, pendingYearName] = await Promise.all([
          yearNameById(sb, subYearId),
          yearNameById(sb, pendingYearId),
        ]);

        return {
          ok: true,
          data: normalizeClassLockRpc(row, {
            subscriptionYearName,
            pendingYearId,
            pendingYearName,
          }),
        };
      }
      if (rpcError && !rpcMissing(rpcError)) {
        return { ok: false, error: rpcError.message };
      }

      // Compat fallback when get_class_lock_state is unavailable.
      const enrollment = await loadEnrollment(sb);
      const [{ data: live }, { data: apps }, { data: subs }] = await Promise.all([
        sb.rpc("has_live_subscription"),
        sb
          .from("subscription_applications")
          .select("id, status, year_id")
          .eq("student_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1),
        sb
          .from("subscriptions")
          .select("id, status, ends_at, grace_days, year_id")
          .eq("student_id", user.id)
          .eq("status", "active")
          .order("ends_at", { ascending: false })
          .limit(1),
      ]);

      const pending = (apps ?? [])[0] ?? null;
      const sub = (subs ?? [])[0] ?? null;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const metaPurchaseYear = metaString(meta, META_PURCHASE_YEAR);

      const pendingYearId =
        (typeof pending?.year_id === "string" ? pending.year_id : null) ??
        metaPurchaseYear;
      const subscriptionYearId =
        (typeof sub?.year_id === "string" ? sub.year_id : null) ??
        metaPurchaseYear ??
        enrollment.year_id;

      const [pendingYearName, subscriptionYearName] = await Promise.all([
        yearNameById(sb, pendingYearId),
        yearNameById(sb, subscriptionYearId),
      ]);

      const state = deriveClassLockState({
        currentYearId: enrollment.year_id,
        currentYearName: enrollment.year_name,
        currentYearNumber: enrollment.year_number,
        hasLiveSubscription: Boolean(live),
        hasPendingApplication: Boolean(pending),
        pendingApplicationId: pending?.id ?? null,
        pendingApplicationYearId: pendingYearId,
        pendingApplicationYearName: pendingYearName,
        subscriptionYearId,
        subscriptionYearName:
          subscriptionYearName ?? enrollment.year_name,
      });

      return { ok: true, data: state };
    },

    async listYears() {
      const sb = await client();
      const { data, error } = await sb.rpc("list_years");
      if (error) return { ok: false, error: error.message };
      const years = (data ?? []) as YearOption[];
      return { ok: true, data: years };
    },

    async selfChangeClass(yearId: string) {
      const sb = await client();
      // Authoritative lock is enforced inside self_change_class RPC.
      const { data, error } = await sb.rpc("self_change_class", {
        p_year_id: yearId,
      });
      if (error && rpcMissing(error)) {
        return { ok: false, error: "spine_unavailable" };
      }
      if (error) return { ok: false, error: error.message };
      const out =
        data && typeof data === "object" && "year_id" in (data as object)
          ? (data as { year_id: string })
          : { year_id: yearId };
      return { ok: true, data: out };
    },

    async recordPurchaseClassIntent(confirmation: PurchaseClassConfirmation) {
      const err = validatePurchaseClassConfirmation({
        yearId: confirmation.year_id,
        confirmed: confirmation.confirmed,
      });
      if (err) return { ok: false, error: err };
      const sb = await client();
      // Compat metadata; create_subscription_application(p_year_id) is authoritative.
      const metaErr = await mergeUserMetadata(sb, {
        [META_PURCHASE_YEAR]: confirmation.year_id,
      });
      if (metaErr) return { ok: false, error: metaErr };
      return { ok: true, data: { year_id: confirmation.year_id } };
    },

    async listOwnYearChangeRequests() {
      const sb = await client();
      const user = await currentUser(sb);
      if (!user) return { ok: false, error: "not_authenticated" };
      const yearsRes = await this.listYears();
      const years = yearsRes.ok ? yearsRes.data : [];
      const yearName = (id: string) =>
        years.find((y) => y.id === id)?.name ?? null;

      const { data, error } = await sb
        .from("year_change_requests")
        .select(
          "id, status, reason, review_note, created_at, reviewed_at, from_year_id, to_year_id"
        )
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { ok: false, error: error.message };

      const mapped: YearChangeRequestView[] = (data ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        review_note: r.review_note,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        from_year_id: r.from_year_id,
        to_year_id: r.to_year_id,
        from_name: yearName(r.from_year_id),
        to_name: yearName(r.to_year_id),
      }));
      return { ok: true, data: mapped };
    },
  };
}

export const META_KEYS = {
  contact: META_CONTACT,
  college: META_COLLEGE,
  avatar: META_AVATAR,
  purchaseYear: META_PURCHASE_YEAR,
} as const;
