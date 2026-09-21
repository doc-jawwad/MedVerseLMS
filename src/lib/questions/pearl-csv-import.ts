/** Pearl point CSV import parser. */

export const PEARL_CSV_HEADERS = [
  "prompt",
  "answer",
  "explanation",
  "subject",
  "chapter",
  "topic",
  "entitlement",
  "sort_order",
] as const;

export type PearlCsvHeader = (typeof PEARL_CSV_HEADERS)[number];

export const PEARL_REQUIRED_HEADERS: readonly PearlCsvHeader[] = [
  "prompt",
  "answer",
];

export type PearlImportRow = {
  row_number: number;
  prompt: string;
  answer: string;
  explanation: string;
  subject: string;
  chapter: string;
  topic: string;
  entitlement: string;
  sort_order: number;
  client_errors?: string[];
};

export function parsePearlCsvRow(
  raw: Record<string, string>,
  rowNumber: number
): PearlImportRow {
  const errors: string[] = [];

  const prompt = (raw["prompt"] ?? "").trim();
  const answer = (raw["answer"] ?? "").trim();
  if (!prompt) errors.push("prompt is required");
  if (!answer) errors.push("answer is required");

  const entitlement = (raw["entitlement"] ?? "free").trim().toLowerCase();
  if (!["free", "any_subscription", "plan"].includes(entitlement)) {
    errors.push(`entitlement must be 'free', 'any_subscription', or 'plan'`);
  }

  const sortOrder = raw["sort_order"]
    ? Number(raw["sort_order"])
    : 0;
  if (raw["sort_order"] && !Number.isFinite(sortOrder)) {
    errors.push("sort_order must be a number");
  }

  return {
    row_number: rowNumber,
    prompt,
    answer,
    explanation: (raw["explanation"] ?? "").trim(),
    subject: (raw["subject"] ?? "").trim(),
    chapter: (raw["chapter"] ?? "").trim(),
    topic: (raw["topic"] ?? "").trim(),
    entitlement: ["free", "any_subscription", "plan"].includes(entitlement)
      ? entitlement
      : "free",
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    ...(errors.length > 0 ? { client_errors: errors } : {}),
  };
}

export function validatePearlCsvHeaders(headers: string[]): string[] {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return PEARL_REQUIRED_HEADERS.filter((h) => !lower.includes(h));
}
