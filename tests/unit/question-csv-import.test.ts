import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_CORRECT_KEYS,
  ALLOWED_DIFFICULTIES,
  QUESTION_CSV_HEADERS,
  QUESTION_CSV_TEMPLATE_EXAMPLE,
  buildChatGptGenerationPrompt,
  buildQuestionCsvTemplateMatrix,
  flattenCsvErrors,
  formatCsvErrorsForCopy,
  parseQuestionCsvRecords,
  toImportPayloadRow,
  validateQuestionCsvHeaders,
  validateQuestionCsvRow,
} from "../../src/lib/questions/csv-import.ts";

const validRow: Record<string, string> = {
  ...QUESTION_CSV_TEMPLATE_EXAMPLE,
};

describe("question CSV canonical schema", () => {
  it("exposes the exact import headers (no invented columns)", () => {
    assert.deepEqual([...QUESTION_CSV_HEADERS], [
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
    ]);
  });

  it("template matrix starts with canonical headers + example row", () => {
    const matrix = buildQuestionCsvTemplateMatrix();
    assert.deepEqual(matrix[0], [...QUESTION_CSV_HEADERS]);
    assert.equal(matrix[1]?.[6], "A");
    assert.equal(matrix[1]?.[13], "virchow|thrombosis");
  });

  it("ChatGPT prompt requires exact headers and allowed values", () => {
    const prompt = buildChatGptGenerationPrompt("Year 1 — Pathology");
    assert.match(prompt, /Preserve exact column names/);
    assert.match(prompt, /Do not add columns/);
    assert.match(prompt, /Do not remove columns/);
    assert.match(prompt, new RegExp(QUESTION_CSV_HEADERS.join(",")));
    assert.match(prompt, /A, B, C, D, E/);
    assert.match(prompt, /easy, medium, or hard/);
    assert.match(prompt, /Year 1 — Pathology/);
  });
});

describe("question CSV header validation", () => {
  it("accepts the canonical header set", () => {
    const r = validateQuestionCsvHeaders([...QUESTION_CSV_HEADERS]);
    assert.equal(r.missing.length, 0);
    assert.equal(r.unexpected.length, 0);
    assert.equal(r.errors.length, 0);
  });

  it("rejects missing required columns", () => {
    const r = validateQuestionCsvHeaders(["question", "option_a", "correct"]);
    assert.ok(r.missing.includes("book"));
    assert.ok(r.errors.some((e) => e.field === "book" && e.row === 1));
  });

  it("rejects unexpected columns", () => {
    const r = validateQuestionCsvHeaders([
      ...QUESTION_CSV_HEADERS,
      "correct_option",
    ]);
    assert.deepEqual(r.unexpected, ["correct_option"]);
    assert.ok(r.errors.some((e) => e.field === "correct_option"));
  });
});

describe("question CSV row validation", () => {
  it("accepts a well-formed row", () => {
    assert.deepEqual(validateQuestionCsvRow(validRow, 2), []);
  });

  it("reports structured correct-key errors (malformed CSV)", () => {
    const errors = validateQuestionCsvRow({ ...validRow, correct: "E" }, 17);
    const hit = errors.find((e) => e.field === "option_e");
    assert.ok(hit);
    assert.equal(hit!.row, 17);
    assert.match(hit!.error, /correct is E/);
    assert.match(hit!.expected, /option_e/);
  });

  it("rejects invalid correct letters with expected A/B/C/D/E", () => {
    const errors = validateQuestionCsvRow({ ...validRow, correct: "Z" }, 17);
    const hit = errors.find((e) => e.field === "correct");
    assert.ok(hit);
    assert.equal(hit!.invalidValue, "Z");
    assert.equal(hit!.expected, "A/B/C/D/E");
  });

  it("rejects invalid difficulty", () => {
    const errors = validateQuestionCsvRow(
      { ...validRow, difficulty: "brutal" },
      3
    );
    assert.ok(errors.some((e) => e.field === "difficulty"));
  });

  it("requires book/chapter/topic", () => {
    const errors = validateQuestionCsvRow(
      { ...validRow, book: "", chapter: " ", topic: "" },
      4
    );
    assert.ok(errors.some((e) => e.field === "book"));
    assert.ok(errors.some((e) => e.field === "chapter"));
    assert.ok(errors.some((e) => e.field === "topic"));
  });

  it("requires options A–D", () => {
    const errors = validateQuestionCsvRow({ ...validRow, option_c: "" }, 5);
    assert.ok(errors.some((e) => e.field === "option_c"));
  });

  it("allows blank difficulty (defaults later to medium)", () => {
    assert.deepEqual(
      validateQuestionCsvRow({ ...validRow, difficulty: "" }, 2),
      []
    );
  });
});

describe("parse + copy-all-errors + retry shape", () => {
  it("parseQuestionCsvRecords attaches row numbers after the header", () => {
    const { rows, headerErrors } = parseQuestionCsvRecords([
      validRow,
      { ...validRow, correct: "Q" },
    ]);
    assert.equal(headerErrors.length, 0);
    assert.equal(rows[0]?.row_number, 2);
    assert.equal(rows[1]?.row_number, 3);
    assert.equal(rows[0]?.errors.length, 0);
    assert.ok(rows[1]!.errors.length > 0);
  });

  it("formatCsvErrorsForCopy is pasteable and includes row/field/expected", () => {
    const { rows, headerErrors } = parseQuestionCsvRecords([
      { ...validRow, correct: "E" },
    ]);
    const text = formatCsvErrorsForCopy(flattenCsvErrors(headerErrors, rows));
    assert.match(text, /MedVerse Question Bank CSV validation failed/);
    assert.match(text, /Row 2/);
    assert.match(text, /option_e/);
    assert.match(text, /Expected:/);
    assert.match(text, /Preserve exact column names/);
  });

  it("correction/retry: fixing the row clears errors", () => {
    const bad = validateQuestionCsvRow({ ...validRow, correct: "Z" }, 2);
    assert.ok(bad.length > 0);
    const fixed = validateQuestionCsvRow({ ...validRow, correct: "A" }, 2);
    assert.deepEqual(fixed, []);
  });

  it("toImportPayloadRow maps CSV columns to RPC fields and pipe tags", () => {
    const payload = toImportPayloadRow(validRow, 2, "subj-1", "draft");
    assert.equal(payload.stem, validRow.question);
    assert.equal(payload.correct_key, "A");
    assert.equal(payload.options.length, 4);
    assert.deepEqual(payload.tags, ["virchow", "thrombosis"]);
    assert.equal(payload.subject_id, "subj-1");
    assert.equal(payload.status, "draft");
    assert.equal(payload.client_errors, undefined);
  });

  it("allowed value sets stay aligned with DB checks", () => {
    assert.deepEqual([...ALLOWED_CORRECT_KEYS], ["A", "B", "C", "D", "E"]);
    assert.deepEqual([...ALLOWED_DIFFICULTIES], ["easy", "medium", "hard"]);
  });
});
