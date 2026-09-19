export function sortByOpensAtAsc<T extends { opens_at: string | null }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.opens_at ? Date.parse(a.opens_at) : Number.POSITIVE_INFINITY;
    const bo = b.opens_at ? Date.parse(b.opens_at) : Number.POSITIVE_INFINITY;
    return ao - bo;
  });
}

export function countdownParts(opensAtIso: string, nowMs: number): {
  label: string;
  ready: boolean;
} {
  const opens = Date.parse(opensAtIso);
  if (!Number.isFinite(opens)) return { label: "", ready: true };
  const delta = opens - nowMs;
  if (delta <= 0) return { label: "Open now", ready: true };
  const totalMin = Math.ceil(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return { label: `Opens in ${days}d ${hours}h`, ready: false };
  if (hours > 0) return { label: `Opens in ${hours}h ${minutes}m`, ready: false };
  return { label: `Opens in ${minutes}m`, ready: false };
}
