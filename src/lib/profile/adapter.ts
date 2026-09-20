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

const META_CONTACT = "contact_number";
const META_COLLEGE = "college_name";
const META_AVATAR = "avatar_object_key";
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

async function buildProfile(
  supabase: Supabase,
  userId: string
): Promise<StudentProfile | null> {
  const [{ data: row }, user, enrollment] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle(),
    currentUser(supabase),
    loadEnrollment(supabase),
  ]);
  if (!row) return null;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const avatarKey = metaString(meta, META_AVATAR);
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
    college_name: metaString(meta, META_COLLEGE),
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

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
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

      const fullName =
        input.full_name !== undefined
          ? String(input.full_name).trim()
          : undefined;
      if (fullName !== undefined) {
        const err = validateFullName(fullName);
        if (err) return { ok: false, error: err };
      }
      if (input.contact_number !== undefined && input.contact_number != null) {
        const err = validateContactNumber(input.contact_number);
        if (err) return { ok: false, error: err };
      }
      if (input.college_name !== undefined && input.college_name != null) {
        const err = validateCollegeName(input.college_name);
        if (err) return { ok: false, error: err };
      }

      // Preferred path when schema lane ships update_own_profile.
      const { error: rpcError } = await sb.rpc("update_own_profile", {
        p_full_name: fullName ?? null,
        p_college_name:
          input.college_name === undefined ? null : input.college_name,
        p_contact_number:
          input.contact_number === undefined
            ? null
            : input.contact_number
              ? normalizeContactNumber(input.contact_number)
              : null,
      });

      if (rpcError && !rpcMissing(rpcError)) {
        return { ok: false, error: rpcError.message };
      }

      if (rpcError && rpcMissing(rpcError)) {
        if (fullName !== undefined) {
          const { error } = await sb
            .from("profiles")
            .update({ full_name: fullName })
            .eq("id", user.id);
          if (error) return { ok: false, error: error.message };
        }
        const metaErr = await mergeUserMetadata(sb, {
          ...(input.contact_number !== undefined
            ? {
                [META_CONTACT]: input.contact_number
                  ? normalizeContactNumber(input.contact_number)
                  : null,
              }
            : {}),
          ...(input.college_name !== undefined
            ? {
                [META_COLLEGE]: input.college_name
                  ? String(input.college_name).trim()
                  : null,
              }
            : {}),
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
        // Bridge: provisional key under study-content until avatar RPC ships.
        // Never use payment-proof bucket.
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
      const { error } = await sb.rpc("authorize_avatar_object", {
        p_object_key: objectKey,
      });
      if (error && !rpcMissing(error)) {
        return { ok: false, error: error.message };
      }
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
        const row = rpcData as ClassLockState;
        return { ok: true, data: row };
      }
      if (rpcError && !rpcMissing(rpcError)) {
        return { ok: false, error: rpcError.message };
      }

      const enrollment = await loadEnrollment(sb);
      const [{ data: live }, { data: apps }, { data: subs }] = await Promise.all([
        sb.rpc("has_live_subscription"),
        sb
          .from("subscription_applications")
          .select("id, status")
          .eq("student_id", user.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1),
        sb
          .from("subscriptions")
          .select("id, status, ends_at, grace_days")
          .eq("student_id", user.id)
          .eq("status", "active")
          .order("ends_at", { ascending: false })
          .limit(1),
      ]);

      const pending = (apps ?? [])[0] ?? null;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const purchaseYearId = metaString(meta, META_PURCHASE_YEAR);

      let pendingYearName: string | null = null;
      let subscriptionYearName: string | null = null;
      if (purchaseYearId) {
        const { data: yearRow } = await sb
          .from("years")
          .select("id, name, year_number")
          .eq("id", purchaseYearId)
          .maybeSingle();
        if (yearRow) {
          pendingYearName = yearRow.name;
          subscriptionYearName = yearRow.name;
        }
      }

      const state = deriveClassLockState({
        currentYearId: enrollment.year_id,
        currentYearName: enrollment.year_name,
        currentYearNumber: enrollment.year_number,
        hasLiveSubscription: Boolean(live),
        hasPendingApplication: Boolean(pending),
        pendingApplicationId: pending?.id ?? null,
        pendingApplicationYearId: purchaseYearId,
        pendingApplicationYearName: pendingYearName,
        // subscriptions.year_id not in schema yet — use purchase intent / current.
        subscriptionYearId: purchaseYearId ?? enrollment.year_id,
        subscriptionYearName:
          subscriptionYearName ?? enrollment.year_name,
      });

      // Silence unused until schema adds year_id on subscriptions.
      void subs;

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
      const lock = await this.getClassLockState();
      if (!lock.ok) return lock;
      if (!lock.data.can_self_change) {
        return { ok: false, error: "class_locked" };
      }

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
