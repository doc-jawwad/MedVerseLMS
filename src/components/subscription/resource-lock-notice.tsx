/**
 * Visual lock affordance for catalog items the DB already marked inaccessible.
 * Authorization remains RPC/RLS — this is UX only.
 * Prefer LockedState for new call sites.
 */
export { LockedState as ResourceLockNotice } from "@/components/student/locked-state";
