import type { StudentHistoryBundle } from "@/lib/student-history/types";

export type StudentHistoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Own-student history reads. Admin 360 uses AdminStudentDetailPort instead.
 * Never expose another student's private history through this port.
 */
export interface StudentHistoryPort {
  getOwnHistory(options?: {
    testLimit?: number;
  }): Promise<StudentHistoryResult<StudentHistoryBundle>>;
}
