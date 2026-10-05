import "server-only";

import { cache } from "react";
import { requireStudent } from "@/lib/auth/require-user";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { loadAcademicTree } from "./load-tree.ts";
import type { AcademicTree, AcademicTreeSurface } from "./types.ts";

export type AcademicTreePageContext = {
  tree: AcademicTree;
  error: string | null;
  hasLiveAccess: boolean;
  year_id: string;
  year_number: number;
  year_name: string;
};

/** Request-scoped: same surface reuses one get_academic_tree RPC. */
export const getAcademicTreePageContext = cache(async function getAcademicTreePageContext(
  surface: AcademicTreeSurface
): Promise<AcademicTreePageContext> {
  const { supabase, enrollment } = await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  const { tree, error } = await loadAcademicTree({
    supabase,
    surface,
    year_id: enrollment.year_id,
    year_number: enrollment.year_number,
    year_name: enrollment.year_name,
    has_live_subscription: hasLiveAccess,
  });

  return {
    tree,
    error,
    hasLiveAccess,
    year_id: enrollment.year_id,
    year_number: enrollment.year_number,
    year_name: enrollment.year_name,
  };
});
