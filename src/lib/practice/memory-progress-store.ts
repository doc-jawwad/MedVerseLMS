import type { PracticeProgressStore } from "./progress-store.ts";
import { progressKey } from "./progress-store.ts";
import type {
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
} from "./types.ts";

function nowIso(clock: () => number = Date.now): string {
  return new Date(clock()).toISOString();
}

/** In-memory mock until Data Spine ships the real table/RPCs. */
export function createMemoryProgressStore(
  initial: readonly PracticeProgressRecord[] = [],
  clock: () => number = Date.now
): PracticeProgressStore {
  const map = new Map<string, PracticeProgressRecord>();
  for (const row of initial) {
    map.set(progressKey(row.studentId, row.itemKind, row.itemId), { ...row });
  }

  function ensure(
    studentId: string,
    itemKind: PracticeItemKind,
    itemId: string
  ): PracticeProgressRecord {
    const key = progressKey(studentId, itemKind, itemId);
    const existing = map.get(key);
    if (existing) return existing;
    const created: PracticeProgressRecord = {
      studentId,
      itemKind,
      itemId,
      state: "remaining",
      marked: false,
      updatedAt: nowIso(clock),
    };
    map.set(key, created);
    return created;
  }

  return {
    async getMany({ studentId, itemKind, itemIds }) {
      const rows = [...map.values()].filter(
        (r) => r.studentId === studentId && r.itemKind === itemKind
      );
      if (!itemIds) return rows.map((r) => ({ ...r }));
      const want = new Set(itemIds);
      return rows.filter((r) => want.has(r.itemId)).map((r) => ({ ...r }));
    },

    async upsert({ studentId, itemKind, itemId, state, marked }) {
      const row = ensure(studentId, itemKind, itemId);
      const next: PracticeProgressRecord = {
        ...row,
        state: state ?? row.state,
        marked: marked ?? row.marked,
        updatedAt: nowIso(clock),
      };
      map.set(progressKey(studentId, itemKind, itemId), next);
      return { ...next };
    },

    async setState({ studentId, itemKind, itemId, state }) {
      return this.upsert({ studentId, itemKind, itemId, state });
    },

    async setMarked({ studentId, itemKind, itemId, marked }) {
      return this.upsert({ studentId, itemKind, itemId, marked });
    },

    async resetDoneToRemaining({ studentId, itemKind, itemIds }) {
      const want = itemIds ? new Set(itemIds) : null;
      let resetCount = 0;
      for (const [key, row] of map) {
        if (row.studentId !== studentId || row.itemKind !== itemKind) continue;
        if (want && !want.has(row.itemId)) continue;
        if (row.state !== "done") continue;
        map.set(key, {
          ...row,
          state: "remaining" satisfies PracticeItemState,
          updatedAt: nowIso(clock),
        });
        resetCount += 1;
      }
      return { resetCount };
    },
  };
}
