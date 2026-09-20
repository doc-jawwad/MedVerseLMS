import type { PracticeProgressStore } from "./progress-store.ts";
import { progressKey } from "./progress-store.ts";
import type {
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
} from "./types.ts";

const STORAGE_PREFIX = "medverse_practice_progress_v1:";

function storageKey(studentId: string, itemKind: PracticeItemKind): string {
  return `${STORAGE_PREFIX}${studentId}:${itemKind}`;
}

function readBucket(
  storage: Storage,
  studentId: string,
  itemKind: PracticeItemKind
): Map<string, PracticeProgressRecord> {
  const raw = storage.getItem(storageKey(studentId, itemKind));
  const map = new Map<string, PracticeProgressRecord>();
  if (!raw) return map;
  try {
    const rows = JSON.parse(raw) as PracticeProgressRecord[];
    if (!Array.isArray(rows)) return map;
    for (const row of rows) {
      if (
        row &&
        row.studentId === studentId &&
        row.itemKind === itemKind &&
        typeof row.itemId === "string"
      ) {
        map.set(progressKey(row.studentId, row.itemKind, row.itemId), row);
      }
    }
  } catch {
    return map;
  }
  return map;
}

function writeBucket(
  storage: Storage,
  studentId: string,
  itemKind: PracticeItemKind,
  map: Map<string, PracticeProgressRecord>
) {
  storage.setItem(
    storageKey(studentId, itemKind),
    JSON.stringify([...map.values()])
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Browser localStorage stand-in for progress when Data Spine RPCs are missing.
 * Production sessions prefer createSpineProgressStore.
 */
export function createLocalProgressStore(
  storage: Storage = globalThis.localStorage
): PracticeProgressStore {
  function ensure(
    studentId: string,
    itemKind: PracticeItemKind,
    itemId: string
  ): {
    map: Map<string, PracticeProgressRecord>;
    row: PracticeProgressRecord;
  } {
    const map = readBucket(storage, studentId, itemKind);
    const key = progressKey(studentId, itemKind, itemId);
    const existing = map.get(key);
    if (existing) return { map, row: existing };
    const created: PracticeProgressRecord = {
      studentId,
      itemKind,
      itemId,
      state: "remaining",
      marked: false,
      updatedAt: nowIso(),
    };
    map.set(key, created);
    writeBucket(storage, studentId, itemKind, map);
    return { map, row: created };
  }

  return {
    async getMany({ studentId, itemKind, itemIds }) {
      const map = readBucket(storage, studentId, itemKind);
      const rows = [...map.values()];
      if (!itemIds) return rows.map((r) => ({ ...r }));
      const want = new Set(itemIds);
      return rows.filter((r) => want.has(r.itemId)).map((r) => ({ ...r }));
    },

    async upsert({ studentId, itemKind, itemId, state, marked }) {
      const { map, row } = ensure(studentId, itemKind, itemId);
      const next: PracticeProgressRecord = {
        ...row,
        state: state ?? row.state,
        marked: marked ?? row.marked,
        updatedAt: nowIso(),
      };
      map.set(progressKey(studentId, itemKind, itemId), next);
      writeBucket(storage, studentId, itemKind, map);
      return { ...next };
    },

    async setState({ studentId, itemKind, itemId, state }) {
      return this.upsert({ studentId, itemKind, itemId, state });
    },

    async setMarked({ studentId, itemKind, itemId, marked }) {
      return this.upsert({ studentId, itemKind, itemId, marked });
    },

    async resetDoneToRemaining({ studentId, itemKind, itemIds }) {
      const map = readBucket(storage, studentId, itemKind);
      const want = itemIds ? new Set(itemIds) : null;
      let resetCount = 0;
      for (const [key, row] of map) {
        if (want && !want.has(row.itemId)) continue;
        if (row.state !== "done") continue;
        map.set(key, {
          ...row,
          state: "remaining" satisfies PracticeItemState,
          updatedAt: nowIso(),
        });
        resetCount += 1;
      }
      writeBucket(storage, studentId, itemKind, map);
      return { resetCount };
    },
  };
}
