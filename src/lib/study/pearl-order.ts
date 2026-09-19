export function orderPearlIds(
  ids: readonly string[],
  shuffle: boolean
): string[] {
  const copy = [...ids];
  if (!shuffle) return copy;
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function pearlProgress(index: number, total: number): string {
  if (total <= 0) return "0 of 0";
  return `${Math.min(index + 1, total)} of ${total}`;
}
