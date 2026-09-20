/**
 * Clean ports for Profile UI ↔ future Data Spine.
 * Implementations must not invent schema; call planned RPCs when present.
 */

import type {
  ClassLockState,
  ProfileUpdateInput,
  PurchaseClassConfirmation,
  StudentProfile,
  YearChangeRequestView,
  YearOption,
} from "@/lib/profile/types";

export type ProfileAdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface StudentProfilePort {
  getOwnProfile(): Promise<ProfileAdapterResult<StudentProfile>>;
  updateOwnProfile(
    input: ProfileUpdateInput
  ): Promise<ProfileAdapterResult<StudentProfile>>;
  /** Planned: allocate_avatar_object_key + authorize_avatar_object. */
  allocateAvatarUpload(): Promise<
    ProfileAdapterResult<{ objectKey: string; uploadUrl: string | null }>
  >;
  /** Persist avatar key after successful PUT (planned RPC or metadata bridge). */
  setAvatarObjectKey(
    objectKey: string
  ): Promise<ProfileAdapterResult<StudentProfile>>;
  clearAvatar(): Promise<ProfileAdapterResult<StudentProfile>>;
}

export interface SubscriptionClassPort {
  getClassLockState(): Promise<ProfileAdapterResult<ClassLockState>>;
  listYears(): Promise<ProfileAdapterResult<YearOption[]>>;
  /**
   * Free students only. Planned RPC: self_change_class(p_year_id).
   * Must reject when lock ≠ free (class_locked).
   */
  selfChangeClass(
    yearId: string
  ): Promise<ProfileAdapterResult<{ year_id: string }>>;
  /**
   * Purchase-class intent for subscription apply.
   * Schema lane will store on subscription_applications.year_id;
   * until then adapters may bridge via metadata without changing payment schema.
   */
  recordPurchaseClassIntent(
    confirmation: PurchaseClassConfirmation
  ): Promise<ProfileAdapterResult<{ year_id: string }>>;
  listOwnYearChangeRequests(): Promise<
    ProfileAdapterResult<YearChangeRequestView[]>
  >;
}
