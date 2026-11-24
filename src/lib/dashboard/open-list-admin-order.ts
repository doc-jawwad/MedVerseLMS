/** Mirror the saved RPC ordering in local UI state after successful reorders. */
export function applySavedOpenListOrder<T extends { id: string; sort_order: number | null }>(
  rows: T[],
  orderedIds: readonly string[]
): T[] {
  const positions = new Map(orderedIds.map((id, index) => [id, index] as const));
  return rows.map((row) => {
    const position = positions.get(row.id);
    return position === undefined ? row : { ...row, sort_order: position };
  });
}
