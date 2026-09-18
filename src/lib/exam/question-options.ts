/**
 * Canonical exam options: array of {key: 'A'..'E', text} (docs/database.md).
 *
 * start_attempt returns `question_versions.options` as stored. Staging (and
 * some fixtures) persist a key→text object instead of the array. That is a
 * complete 4–5 option set, not garbage — convert it. Anything else throws;
 * we do not invent empty option lists.
 */

export type ExamOption = { key: string; text: string };

const KEYS = ["A", "B", "C", "D", "E"] as const;
const KEY_SET = new Set<string>(KEYS);

export function examOptionsFromRpc(raw: unknown): ExamOption[] {
  if (Array.isArray(raw)) {
    return fromCanonicalArray(raw);
  }
  if (raw !== null && typeof raw === "object") {
    return fromKeyMap(raw as Record<string, unknown>);
  }
  throw new Error("question options must be a {key,text} array or A–E key map");
}

function fromCanonicalArray(raw: unknown[]): ExamOption[] {
  const out: ExamOption[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("question option entries must be {key, text} objects");
    }
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim().toUpperCase() : "";
    const text = typeof rec.text === "string" ? rec.text : "";
    if (!KEY_SET.has(key) || text.trim() === "") {
      throw new Error("question option entries need key A–E and non-empty text");
    }
    out.push({ key, text });
  }
  assertCount(out.length);
  assertUniqueKeys(out);
  return out;
}

function fromKeyMap(raw: Record<string, unknown>): ExamOption[] {
  const keys = Object.keys(raw);
  if (keys.some((k) => !KEY_SET.has(k))) {
    throw new Error("question option map keys must be A–E");
  }
  const out: ExamOption[] = [];
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const text = raw[key];
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error("question option map values must be non-empty strings");
    }
    out.push({ key, text });
  }
  assertCount(out.length);
  return out;
}

function assertCount(n: number) {
  if (n < 4 || n > 5) {
    throw new Error("question options must have 4 or 5 entries");
  }
}

function assertUniqueKeys(opts: ExamOption[]) {
  const seen = new Set<string>();
  for (const o of opts) {
    if (seen.has(o.key)) throw new Error("question option keys must be unique");
    seen.add(o.key);
  }
}
