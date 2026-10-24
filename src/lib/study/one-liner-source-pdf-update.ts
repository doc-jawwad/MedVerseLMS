/**
 * PostgREST `.update().select("id").maybeSingle()` outcome helpers for
 * Prof. Session one-liner source PDF attach/clear.
 *
 * Zero-row updates return `{ data: null, error: null }` — callers must not
 * treat that as success or discard the previous object key.
 */

export type MaybeSingleUpdateRow = { id: string } | null;

export type InterpretedUpdate =
  | { ok: true; id: string }
  | { ok: false; reason: "error" | "zero_rows"; error?: { message?: string | null } | null };

export function interpretMaybeSingleUpdate(
  data: MaybeSingleUpdateRow,
  error: { message?: string | null } | null | undefined
): InterpretedUpdate {
  if (error) return { ok: false, reason: "error", error };
  if (!data?.id) return { ok: false, reason: "zero_rows" };
  return { ok: true, id: data.id };
}

/** Keys to discard after an attach update attempt (authorize_study_object_discard + R2 delete). */
export function discardKeysAfterAttachUpdate(opts: {
  updateOk: boolean;
  newKey: string;
  previousKey: string | null;
}): string[] {
  if (!opts.updateOk) {
    // Failed or zero-row: drop the newly uploaded object only; keep previous PDF.
    return [opts.newKey];
  }
  if (opts.previousKey && opts.previousKey !== opts.newKey) {
    return [opts.previousKey];
  }
  return [];
}

/** Keys to discard after a clear update attempt. */
export function discardKeysAfterClearUpdate(opts: {
  updateOk: boolean;
  previousKey: string | null;
}): string[] {
  if (!opts.updateOk) return [];
  return opts.previousKey ? [opts.previousKey] : [];
}
