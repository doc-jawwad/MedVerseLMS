import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcademicTree,
  AcademicTreeSurface,
  GetAcademicTreeInput,
} from "./types.ts";
import {
  buildStructuralAcademicTree,
  structuralAcademicTreeAdapter,
} from "./adapter.ts";
import { searchAcademicTreeNames } from "./search.ts";
import type { AcademicSearchHit } from "./types.ts";

/**
 * Loads the academic tree for a student surface.
 * Tries planned RPC `get_academic_tree` when present; otherwise uses the
 * structural adapter (no schema invention).
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
  } catch {
    // RPC not deployed yet — fall through to structural adapter.
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

function mapRpcTree(
  raw: unknown,
  input: GetAcademicTreeInput
): AcademicTree | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.subjects)) {
    // Partial / unexpected shape — prefer structural scaffolding.
    return buildStructuralAcademicTree(input);
  }

  // When schema lane ships a full shape, map here. Until then, merge
  // year identity from RPC with structural categories so UI stays stable.
  const structural = buildStructuralAcademicTree({
    ...input,
    year_id: typeof row.year_id === "string" ? row.year_id : input.year_id,
    year_name:
      typeof row.year_name === "string" ? row.year_name : input.year_name,
  });
  return { ...structural, from_adapter: false };
}
