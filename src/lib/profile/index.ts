export type {
  ClassLockKind,
  ClassLockState,
  LeaderboardSafeIdentity,
  ProfileUpdateInput,
  PurchaseClassConfirmation,
  StudentProfile,
  YearChangeRequestView,
  YearOption,
} from "@/lib/profile/types";
export type {
  StudentProfilePort,
  SubscriptionClassPort,
  ProfileAdapterResult,
} from "@/lib/profile/ports";
export {
  deriveClassLockState,
  classLockAllowsSelfChange,
} from "@/lib/profile/class-lock";
export {
  toLeaderboardSafeIdentity,
  stripPrivateProfileFields,
  assertNoPrivateKeys,
  PROFILE_PRIVATE_KEYS,
} from "@/lib/profile/privacy";
export {
  classLockHeadline,
  classLockExplanation,
  classLockBadgeLabel,
  classControlDisabledReason,
  purchaseClassConfirmLabel,
  purchaseClassPrompt,
  profileErrorMessage,
} from "@/lib/profile/presentation";
export {
  validateContactNumber,
  validateCollegeName,
  validateFullName,
  validatePurchaseClassConfirmation,
  validateAvatarFile,
  normalizeContactNumber,
  AVATAR_MAX_BYTES,
} from "@/lib/profile/validation";
