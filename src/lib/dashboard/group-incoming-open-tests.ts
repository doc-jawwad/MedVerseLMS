/**
 * Dashboard Incoming presentation overlay for Issue 11.
 * Does not change incoming membership — only order and section headings.
 */

export type OpenListGroupMeta = {
  id: string;
  name: string;
  sort_order: number;
};

export type OpenListPlacementMeta = {
  test_id: string;
  group_id: string | null;
  sort_order: number;
};

export type IncomingOpenListSection<T> = {
  /** Null = ungrouped fallback ("Other tests"). */
  groupId: string | null;
  title: string;
  items: T[];
};

export const OPEN_LIST_UNGROUPED_TITLE = "Other tests";

function opensAtMs(opensAt: string | null | undefined): number {
  if (!opensAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(opensAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function compareIncomingItems<
  T extends { id: string; opens_at?: string | null },
>(
  a: { item: T; sort_order: number | null },
  b: { item: T; sort_order: number | null }
): number {
  const aHas = a.sort_order != null;
  const bHas = b.sort_order != null;
  if (aHas && bHas && a.sort_order !== b.sort_order) {
    return (a.sort_order as number) - (b.sort_order as number);
  }
  if (aHas !== bHas) return aHas ? -1 : 1;
  return (
    opensAtMs(a.item.opens_at) - opensAtMs(b.item.opens_at) ||
    a.item.id.localeCompare(b.item.id)
  );
}

/**
 * Group and order already-filtered Incoming tests.
 * Missing placement, null group_id, or orphan group_id → ungrouped fallback.
 * Closed / non-incoming tests must already be excluded by the caller.
 */
export function groupIncomingOpenTests<
  T extends { id: string; opens_at?: string | null },
>(args: {
  items: T[];
  groups: OpenListGroupMeta[];
  placements: OpenListPlacementMeta[];
}): IncomingOpenListSection<T>[] {
  const placementByTest = new Map(
    args.placements.map((p) => [p.test_id, p] as const)
  );
  const knownGroupIds = new Set(args.groups.map((g) => g.id));

  const groupsSorted = [...args.groups].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );

  const sections: IncomingOpenListSection<T>[] = [];
  const assigned = new Set<string>();

  for (const group of groupsSorted) {
    const members: { item: T; sort_order: number | null }[] = [];
    for (const item of args.items) {
      const placement = placementByTest.get(item.id);
      if (!placement || placement.group_id !== group.id) continue;
      members.push({ item, sort_order: placement.sort_order });
      assigned.add(item.id);
    }
    if (members.length === 0) continue;
    members.sort(compareIncomingItems);
    sections.push({
      groupId: group.id,
      title: group.name,
      items: members.map((m) => m.item),
    });
  }

  const ungrouped: { item: T; sort_order: number | null }[] = [];
  for (const item of args.items) {
    if (assigned.has(item.id)) continue;
    const placement = placementByTest.get(item.id);
    const inKnownGroup =
      placement?.group_id != null && knownGroupIds.has(placement.group_id);
    if (inKnownGroup) continue; // should not happen; defensive
    const manualUngroupedOrder =
      placement && placement.group_id == null ? placement.sort_order : null;
    ungrouped.push({ item, sort_order: manualUngroupedOrder });
  }

  if (ungrouped.length > 0) {
    ungrouped.sort(compareIncomingItems);
    sections.push({
      groupId: null,
      title: OPEN_LIST_UNGROUPED_TITLE,
      items: ungrouped.map((u) => u.item),
    });
  }

  return sections;
}
