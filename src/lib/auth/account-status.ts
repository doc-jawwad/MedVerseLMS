export type AccountStatus =
  | "active"
  | "restricted"
  | "suspended"
  | "deactivated"
  | "revoked";

export function isBlockedAccountStatus(
  status: string | null | undefined
): boolean {
  return (
    status === "restricted" ||
    status === "suspended" ||
    status === "deactivated" ||
    status === "revoked"
  );
}
