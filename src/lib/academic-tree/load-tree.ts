import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcademicTree,
  AcademicTreeSurface,
  GetAcademicTreeInput,
} from "./types.ts";
import { structuralAcademicTreeAdapter } from "./adapter.ts";
import { mapRpcTree } from "./map-rpc-tree.ts";
import { searchAcademicTreeNames } from "./search.ts";
import type { AcademicSearchHit } from "./types.ts";

export { mapRpcTree, productKeyForSubjectName } from "./map-rpc-tree.ts";

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883") ||
    msg.includes("no_active_enrollment")
  );
}

/**
 * Loads the academic tree for a student surface.
 * Prefers Data Spine `get_academic_tree`; structural scaffolding is
 * compatibility-only when the RPC is missing or the caller has no enrollment.
 */
export async function loadAcademicTree(args: {
  supabase: SupabaseClient;
  surface: AcademicTreeSurface;
  year_id: string;
  year_number: number;
  year_name: string;
  has_live_subscription: boolean;
}): Promise<{ tree: AcademicTree; error: string | null }> {
  const input: GetAcademicTreeInput = {
    surface: args.surface,
    year_id: args.year_id,
    year_number: args.year_number,
    year_name: args.year_name,
    has_live_subscription: args.has_live_subscription,
  };

  try {
    const { data, error } = await args.supabase.rpc("get_academic_tree", {
      p_surface: args.surface,
    });

    if (!error && data && typeof data === "object") {
      const mapped = mapRpcTree(data, input);
      if (mapped) return { tree: mapped, error: null };
    }

    if (error && !rpcMissing(error)) {
      return {
        tree: await structuralAcademicTreeAdapter.getAcademicTree(input),
        error: error.message,
      };
    }
  } catch {
    // Fall through to structural adapter.
  }

  const tree = await structuralAcademicTreeAdapter.getAcademicTree(input);
  return { tree, error: null };
}

export function searchLoadedTree(args: {
  tree: AcademicTree;
  query: string;
  limit?: number;
}): AcademicSearchHit[] {
  return searchAcademicTreeNames(args);
}
