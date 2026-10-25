/**
 * Default subject when linking / importing content into a contextual admin surface
 * (e.g. Prof. Session day Practice CSV).
 *
 * Prefer an explicit context subject (the day / folder / locked subject) when it
 * appears in the option list. Never fall back to subjects[0] — Final Year orders
 * Medicine first by sort_order, which silently mis-tagged non-Medicine days.
 */
export function resolveLinkingSubjectDefault(opts: {
  subjects: { id: string }[];
  preferredSubjectId?: string | null;
}): string {
  const preferred = opts.preferredSubjectId?.trim() || "";
  if (!preferred) return "";
  return opts.subjects.some((s) => s.id === preferred) ? preferred : "";
}
