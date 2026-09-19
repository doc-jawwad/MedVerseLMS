/**
 * Canonical Question Bank CSV import schema + client validation.
 * Column names must match Admin template / import_question_batch mapping —
 * do not invent alternate headers.
 */

export const QUESTION_CSV_HEADERS = [
  "question",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "correct",
  "explanation",
  "reference",
  "book",
  "chapter",
  "topic",
  "difficulty",
  "tags",
] as const;

export type QuestionCsvHeader = (typeof QUESTION_CSV_HEADERS)[number];

export const QUESTION_CSV_REQUIRED_HEADERS = [
  "question",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct",
  "book",
  "chapter",
  "topic",
] as const satisfies readonly QuestionCsvHeader[];

export const ALLOWED_CORRECT_KEYS = ["A", "B", "C", "D", "E"] as const;
export const ALLOWED_DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** Example row used in the downloadable template (and ChatGPT prompt). */
export const QUESTION_CSV_TEMPLATE_EXAMPLE: Record<QuestionCsvHeader, string> = {
  question: "Which of the following is a component of Virchow triad?",
  option_a: "Endothelial injury",
  option_b: "Protein C activation",
  option_c: "Increased prostacyclin",
  option_d: "Thrombomodulin expression",
  option_e: "",
  correct: "A",
  explanation:
    "Virchow triad: endothelial injury, abnormal flow, hypercoagulability.",
  reference: "Robbins, Hemodynamic Disorders",
  book: "Robbins Basic Pathology",
  chapter: "Hemodynamic Disorders",
  topic: "Thrombosis",
  difficulty: "easy",
  tags: "virchow|thrombosis",
};

export type CsvFieldError = {
  row: number;
  field: string;
  error: string;
  invalidValue?: string;
  expected: string;
};

export type ParsedCsvRow = {
  row_number: number;
  raw: Record<string, string>;
  errors: CsvFieldError[];
};

export type HeaderValidation = {
  missing: string[];
  unexpected: string[];
  errors: CsvFieldError[];
};

function safeValue(value: string | undefined, max = 120): string | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}

function fieldError(
  row: number,
  field: string,
  error: string,
  expected: string,
  invalidValue?: string
): CsvFieldError {
  return {
    row,
    field,
    error,
    expected,
    ...(invalidValue !== undefined ? { invalidValue } : {}),
  };
}

/** Validate CSV header row against the canonical schema. */
export function validateQuestionCsvHeaders(
  headers: string[]
): HeaderValidation {
  const normalized = headers.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const set = new Set(normalized);
  const missing = QUESTION_CSV_REQUIRED_HEADERS.filter((h) => !set.has(h));
  const allowed = new Set<string>(QUESTION_CSV_HEADERS);
  const unexpected = normalized.filter((h) => !allowed.has(h));

  const errors: CsvFieldError[] = [];
  for (const h of missing) {
    errors.push(
      fieldError(
        1,
        h,
        "Required column missing from header row",
        `Include column "${h}" exactly (lowercase)`
      )
    );
  }
  for (const h of unexpected) {
    errors.push(
      fieldError(
        1,
        h,
        "Unexpected column — not part of MedVerse Question Bank schema",
        `Use only: ${QUESTION_CSV_HEADERS.join(", ")}`,
        h
      )
    );
  }
  return { missing, unexpected, errors };
}

/** Per-row validation mirroring create_question / import rules. */
export function validateQuestionCsvRow(
  raw: Record<string, string>,
  rowNumber: number
): CsvFieldError[] {
  const errors: CsvFieldError[] = [];
  const get = (k: string) => (raw[k] ?? "").trim();

  if (!get("question")) {
    errors.push(
      fieldError(
        rowNumber,
        "question",
        "Missing question stem",
        "Non-empty question text",
        safeValue(raw.question)
      )
    );
  }

  for (const k of ["option_a", "option_b", "option_c", "option_d"] as const) {
    if (!get(k)) {
      errors.push(
        fieldError(
          rowNumber,
          k,
          "Required option is empty",
          "Non-empty option text (A–D required)",
          safeValue(raw[k])
        )
      );
    }
  }

  const correctRaw = get("correct");
  const correct = correctRaw.toUpperCase();
  if (
    !correct ||
    !ALLOWED_CORRECT_KEYS.includes(correct as (typeof ALLOWED_CORRECT_KEYS)[number])
  ) {
    errors.push(
      fieldError(
        rowNumber,
        "correct",
        "Invalid correct option key",
        "A/B/C/D/E",
        safeValue(correctRaw || raw.correct)
      )
    );
  } else if (correct === "E" && !get("option_e")) {
    errors.push(
      fieldError(
        rowNumber,
        "option_e",
        "correct is E but option_e is empty",
        "Non-empty option_e when correct=E",
        safeValue(raw.option_e)
      )
    );
  } else if (correct !== "E") {
    const optKey = `option_${correct.toLowerCase()}` as QuestionCsvHeader;
    if (!get(optKey)) {
      errors.push(
        fieldError(
          rowNumber,
          "correct",
          `correct is ${correct} but ${optKey} is empty`,
          `Filled ${optKey} matching correct=${correct}`,
          correct
        )
      );
    }
  }

  for (const k of ["book", "chapter", "topic"] as const) {
    if (!get(k)) {
      errors.push(
        fieldError(
          rowNumber,
          k,
          "Required curriculum name is empty",
          `Non-empty ${k} name (matched under the chosen subject)`,
          safeValue(raw[k])
        )
      );
    }
  }

  const diff = get("difficulty").toLowerCase();
  if (
    diff &&
    !ALLOWED_DIFFICULTIES.includes(diff as (typeof ALLOWED_DIFFICULTIES)[number])
  ) {
    errors.push(
      fieldError(
        rowNumber,
        "difficulty",
        "Invalid difficulty",
        "easy/medium/hard (or leave blank for medium)",
        safeValue(raw.difficulty)
      )
    );
  }

  return errors;
}

export function parseQuestionCsvRecords(
  records: Record<string, string>[],
  headerRowNumber = 1
): { rows: ParsedCsvRow[]; headerErrors: CsvFieldError[] } {
  const headers =
    records.length > 0
      ? Object.keys(records[0] ?? {})
      : [...QUESTION_CSV_HEADERS];
  const headerCheck = validateQuestionCsvHeaders(headers);
  const rows = records.map((raw, i) => {
    const row_number = i + headerRowNumber + 1;
    return {
      row_number,
      raw,
      errors: validateQuestionCsvRow(raw, row_number),
    };
  });
  return { rows, headerErrors: headerCheck.errors };
}

export function flattenCsvErrors(
  headerErrors: CsvFieldError[],
  rows: ParsedCsvRow[]
): CsvFieldError[] {
  return [...headerErrors, ...rows.flatMap((r) => r.errors)];
}

/** Pasteable into ChatGPT for correction — stable, plain-text format. */
export function formatCsvErrorsForCopy(errors: CsvFieldError[]): string {
  if (errors.length === 0) {
    return "No validation errors.\n";
  }
  const lines = [
    "MedVerse Question Bank CSV validation failed.",
    "",
    "Please fix the CSV using the MedVerse template.",
    "Preserve exact column names. Do not add or remove columns.",
    "Allowed correct values: A/B/C/D/E. Allowed difficulty: easy/medium/hard.",
    "Tags use pipe separators (|). option_e is optional unless correct=E.",
    "",
    `Total errors: ${errors.length}`,
    "",
  ];
  for (const e of errors) {
    lines.push(`Row ${e.row}`);
    lines.push(e.field);
    if (e.invalidValue !== undefined) {
      lines.push(`Invalid value: ${e.invalidValue}`);
    }
    lines.push(`Error: ${e.error}`);
    lines.push(`Expected: ${e.expected}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function buildQuestionCsvTemplateMatrix(): string[][] {
  return [
    [...QUESTION_CSV_HEADERS],
    QUESTION_CSV_HEADERS.map((h) => QUESTION_CSV_TEMPLATE_EXAMPLE[h]),
  ];
}

export function buildChatGptGenerationPrompt(subjectLabel?: string): string {
  const subjectNote = subjectLabel
    ? `Target subject (chosen in MedVerse Admin, not a CSV column): ${subjectLabel}.`
    : "The admin will choose the target subject in MedVerse Admin (subject is not a CSV column).";

  return [
    "You are generating MCQs for MedVerse LMS Question Bank CSV import.",
    "",
    "CRITICAL RULES:",
    "- Use the supplied MedVerse CSV template columns exactly.",
    "- Preserve exact column names (lowercase).",
    "- Do not add columns. Do not remove columns. Do not rename columns.",
    "- Generate valid data rows only.",
    "- Output CSV only (header + data rows), suitable for MedVerse upload.",
    "- No markdown fences unless the user explicitly asks for them.",
    "",
    subjectNote,
    "",
    "Exact header row (copy exactly):",
    QUESTION_CSV_HEADERS.join(","),
    "",
    "Column rules:",
    "- question: required stem text",
    "- option_a, option_b, option_c, option_d: required",
    "- option_e: optional; required only when correct=E",
    "- correct: exactly one of A, B, C, D, E (must match a filled option)",
    "- explanation: optional but preferred",
    "- reference: optional",
    "- book, chapter, topic: required names under the chosen subject (matched case-insensitively; may be created on import)",
    "- difficulty: easy, medium, or hard (blank → medium)",
    "- tags: pipe-separated labels, e.g. virchow|thrombosis (comma is NOT the separator)",
    "",
    "Example valid row:",
    QUESTION_CSV_HEADERS.map((h) => QUESTION_CSV_TEMPLATE_EXAMPLE[h]).join(","),
    "",
    "After any MedVerse validation error report is pasted, correct only the failing rows/fields and return a full corrected CSV with the same headers.",
  ].join("\n");
}

export function toImportPayloadRow(
  raw: Record<string, string>,
  rowNumber: number,
  subjectId: string,
  status: string,
  clientErrors?: string[]
): {
  row_number: number;
  subject_id: string;
  book: string;
  chapter: string;
  topic: string;
  stem: string;
  options: { key: string; text: string }[];
  correct_key: string;
  explanation: string;
  reference: string;
  difficulty: string;
  tags: string[];
  status: string;
  client_errors?: string[];
} {
  const options = (["a", "b", "c", "d", "e"] as const)
    .map((k) => ({
      key: k.toUpperCase(),
      text: (raw[`option_${k}`] ?? "").trim(),
    }))
    .filter((o) => o.text !== "");

  return {
    row_number: rowNumber,
    subject_id: subjectId,
    book: (raw.book ?? "").trim(),
    chapter: (raw.chapter ?? "").trim(),
    topic: (raw.topic ?? "").trim(),
    stem: (raw.question ?? "").trim(),
    options,
    correct_key: (raw.correct ?? "").trim().toUpperCase(),
    explanation: (raw.explanation ?? "").trim(),
    reference: (raw.reference ?? "").trim(),
    difficulty:
      (raw.difficulty ?? "medium").trim().toLowerCase() || "medium",
    tags: (raw.tags ?? "")
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean),
    status,
    ...(clientErrors && clientErrors.length > 0
      ? { client_errors: clientErrors }
      : {}),
  };
}
