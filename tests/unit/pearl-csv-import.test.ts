import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PEARL_CSV_HEADERS,
  PEARL_REQUIRED_HEADERS,
  parsePearlCsvRow,
  validatePearlCsvHeaders,
} from "../../src/lib/questions/pearl-csv-import.ts";

describe("pearl CSV headers", () => {
  it("exposes expected headers", () => {
    assert.deepEqual([...PEARL_CSV_HEADERS], [
      "prompt", "answer", "explanation", "subject",
      "chapter", "topic", "entitlement", "sort_order",
    ]);
  });

  it("required headers are subset of all headers", () => {
    for (const h of PEARL_REQUIRED_HEADERS) {
      assert.ok(
        (PEARL_CSV_HEADERS as readonly string[]).includes(h),
        `${h} should be in PEARL_CSV_HEADERS`
      );
    }
  });
});

describe("validatePearlCsvHeaders", () => {
  it("returns empty when all required headers present", () => {
    assert.deepEqual(validatePearlCsvHeaders(["prompt", "answer"]), []);
  });

  it("returns missing headers", () => {
    const missing = validatePearlCsvHeaders(["prompt"]);
    assert.ok(missing.includes("answer"));
  });

  it("is case-insensitive", () => {
    assert.deepEqual(validatePearlCsvHeaders(["PROMPT", "ANSWER"]), []);
  });

  it("returns both missing required headers", () => {
    assert.deepEqual(validatePearlCsvHeaders([]).sort(), ["answer", "prompt"]);
  });
});

describe("parsePearlCsvRow", () => {
  it("parses a valid row", () => {
    const row = parsePearlCsvRow({
      prompt: "What is the drug of choice?",
      answer: "Metformin",
      explanation: "First-line for T2DM",
      subject: "Medicine",
      chapter: "Endocrinology",
      topic: "Diabetes",
      entitlement: "free",
      sort_order: "5",
    }, 1);
    assert.equal(row.prompt, "What is the drug of choice?");
    assert.equal(row.answer, "Metformin");
    assert.equal(row.entitlement, "free");
    assert.equal(row.sort_order, 5);
    assert.equal(row.client_errors, undefined);
  });

  it("errors on missing prompt", () => {
    const row = parsePearlCsvRow({ prompt: "", answer: "X" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("prompt")));
  });

  it("errors on missing answer", () => {
    const row = parsePearlCsvRow({ prompt: "Q?", answer: "" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("answer")));
  });

  it("defaults entitlement to free for invalid value", () => {
    const row = parsePearlCsvRow({ prompt: "Q?", answer: "A", entitlement: "gold" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("entitlement")));
    assert.equal(row.entitlement, "free");
  });

  it("defaults sort_order to 0 when missing", () => {
    const row = parsePearlCsvRow({ prompt: "Q?", answer: "A" }, 1);
    assert.equal(row.sort_order, 0);
  });

  it("errors on non-numeric sort_order", () => {
    const row = parsePearlCsvRow({ prompt: "Q?", answer: "A", sort_order: "abc" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("sort_order")));
  });

  it("stores row_number", () => {
    const row = parsePearlCsvRow({ prompt: "Q?", answer: "A" }, 42);
    assert.equal(row.row_number, 42);
  });
});
