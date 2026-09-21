/** One-liner CSV import parser. */

export const ONE_LINER_CSV_HEADERS = [
  "title",
  "body",
  "subject",
  "status",
] as const;

export type OneLinerCsvHeader = (typeof ONE_LINER_CSV_HEADERS)[number];

export const ONE_LINER_REQUIRED_HEADERS: readonly OneLinerCsvHeader[] = [
  "title",
  "body",
];

export type OneLinerImportRow = {
  row_number: number;
  title: string;
  body: string;
  subject: string;
  status: "draft" | "published";
  client_errors?: string[];
};

export function parseOneLinerCsvRow(
  raw: Record<string, string>,
  rowNumber: number
): OneLinerImportRow {
  const errors: string[] = [];

  const title = (raw["title"] ?? "").trim();
  const body = (raw["body"] ?? "").trim();
  if (!title) errors.push("title is required");
  if (!body) errors.push("body is required");

  const rawStatus = (raw["status"] ?? "draft").trim().toLowerCase();
  const status: "draft" | "published" =
    rawStatus === "published" ? "published" : "draft";

  return {
    row_number: rowNumber,
    title,
    body,
    subject: (raw["subject"] ?? "").trim(),
    status,
    ...(errors.length > 0 ? { client_errors: errors } : {}),
  };
}

export function validateOneLinerCsvHeaders(headers: string[]): string[] {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return ONE_LINER_REQUIRED_HEADERS.filter((h) => !lower.includes(h));
}
