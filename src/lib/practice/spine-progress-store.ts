"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PracticeProgressStore } from "./progress-store.ts";
import { createLocalProgressStore } from "./local-progress-store.ts";
import type {
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
} from "./types.ts";

function rpcMissing(error: { message?: string | null } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

/** App kind `mcq` maps to Data Spine `question`; `ospe` stays `ospe`. */
export function toSpineItemKind(
  kind: PracticeItemKind
): "question" | "pearl" | "ospe" {
  if (kind === "mcq") return "question";
  if (kind === "ospe") return "ospe";
  return "pearl";
}

export function fromSpineItemKind(
  kind: string
): PracticeItemKind | null {
  if (kind === "question") return "mcq";
  if (kind === "pearl") return "pearl";
  if (kind === "ospe") return "ospe";
  return null;
}

type SpineProgressItem = {
  item_kind?: string;
  item_id?: string;
  state?: string;
  marked?: boolean;
};

function mapSpineItems(
  studentId: string,
  items: unknown,
  itemKind: PracticeItemKind,
  itemIds?: readonly string[]
): PracticeProgressRecord[] {
  if (!Array.isArray(items)) return [];
  const wantKind = toSpineItemKind(itemKind);
  const wantIds = itemIds ? new Set(itemIds) : null;
  const now = new Date().toISOString();
  const out: PracticeProgressRecord[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as SpineProgressItem;
    if (row.item_kind !== wantKind) continue;
    if (typeof row.item_id !== "string") continue;
    if (wantIds && !wantIds.has(row.item_id)) continue;
    const state: PracticeItemState =
      row.state === "done" ? "done" : "remaining";
    out.push({
      studentId,
      itemKind,
      itemId: row.item_id,
      state,
      marked: Boolean(row.marked),
      updatedAt: now,
    });
  }
  return out;
}

/**
 * Data Spine–backed PracticeProgressStore.
 * Falls back to localStorage only when progress RPCs are missing (compat).
 */
export function createSpineProgressStore(opts: {
  supabase: SupabaseClient;
  /** Subject ids used for get/reset (item writes resolve subject server-side). */
  subjectIds: readonly string[];
  studentId: string;
}): PracticeProgressStore {
  const { supabase, subjectIds, studentId } = opts;
  let compat: PracticeProgressStore | null = null;

  function localFallback(): PracticeProgressStore {
    if (!compat) compat = createLocalProgressStore();
    return compat;
  }

  async function loadSubjectItems(
    subjectId: string
  ): Promise<{ items: unknown; missing: boolean; error: string | null }> {
    const { data, error } = await supabase.rpc("get_practice_progress", {
      p_subject_id: subjectId,
    });
    if (error && rpcMissing(error)) {
      return { items: [], missing: true, error: null };
    }
    if (error) {
      return { items: [], missing: false, error: error.message };
    }
    const row =
      data && typeof data === "object"
        ? (data as { items?: unknown })
        : null;
    return { items: row?.items ?? [], missing: false, error: null };
  }

  return {
    async getMany({ studentId: sid, itemKind, itemIds }) {
      if (subjectIds.length === 0) return [];
      const merged: PracticeProgressRecord[] = [];
      let anyMissing = false;
      for (const subjectId of subjectIds) {
        const loaded = await loadSubjectItems(subjectId);
        if (loaded.missing) {
          anyMissing = true;
          break;
        }
        if (loaded.error) {
          // Visibility/access errors → empty progress, not local invent.
          continue;
        }
        merged.push(...mapSpineItems(sid, loaded.items, itemKind, itemIds));
      }
      if (anyMissing) {
        return localFallback().getMany({ studentId: sid, itemKind, itemIds });
      }
      return merged;
    },

    async upsert({ studentId: sid, itemKind, itemId, state, marked }) {
      const spineKind = toSpineItemKind(itemKind);
      let usedLocal = false;

      if (state !== undefined) {
        const { error } = await supabase.rpc("set_practice_item_state", {
          p_item_kind: spineKind,
          p_item_id: itemId,
          p_state: state,
        });
        if (error && rpcMissing(error)) {
          usedLocal = true;
        } else if (error) {
          throw new Error(error.message);
        }
      }

      if (marked !== undefined) {
        const { error } = await supabase.rpc("set_practice_item_marked", {
          p_item_kind: spineKind,
          p_item_id: itemId,
          p_marked: marked,
        });
        if (error && rpcMissing(error)) {
          usedLocal = true;
        } else if (error) {
          throw new Error(error.message);
        }
      }

      if (usedLocal) {
        return localFallback().upsert({
          studentId: sid,
          itemKind,
          itemId,
          state,
          marked,
        });
      }

      return {
        studentId: sid,
        itemKind,
        itemId,
        state: state ?? "remaining",
        marked: marked ?? false,
        updatedAt: new Date().toISOString(),
      };
    },

    async setState(params) {
      return this.upsert({
        studentId: params.studentId,
        itemKind: params.itemKind,
        itemId: params.itemId,
        state: params.state,
      });
    },

    async setMarked(params) {
      return this.upsert({
        studentId: params.studentId,
        itemKind: params.itemKind,
        itemId: params.itemId,
        marked: params.marked,
      });
    },

    async resetDoneToRemaining({ studentId: sid, itemKind, itemIds }) {
      if (subjectIds.length === 0) {
        return localFallback().resetDoneToRemaining({
          studentId: sid,
          itemKind,
          itemIds,
        });
      }

      let resetCount = 0;
      let anyMissing = false;
      for (const subjectId of subjectIds) {
        const { error } = await supabase.rpc(
          "reset_practice_done_to_remaining",
          { p_subject_id: subjectId }
        );
        if (error && rpcMissing(error)) {
          anyMissing = true;
          break;
        }
        if (error) {
          throw new Error(error.message);
        }
        resetCount += 1;
      }

      if (anyMissing) {
        return localFallback().resetDoneToRemaining({
          studentId: sid,
          itemKind,
          itemIds,
        });
      }

      // RPC is subject-scoped (preserves marked). Count is approximate.
      return { resetCount };
    },
  };
}

export async function startPracticeSessionRpc(
  supabase: SupabaseClient,
  subjectId: string | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc("start_practice_session", {
    p_subject_id: subjectId,
  });
  if (error || typeof data !== "string") return null;
  return data;
}

export async function endPracticeSessionRpc(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    durationMs: number;
    counts: { practiced: number; correct: number };
  }
): Promise<void> {
  await supabase.rpc("end_practice_session", {
    p_session_id: input.sessionId,
    p_duration_ms: input.durationMs,
    p_counts: input.counts,
  });
}
