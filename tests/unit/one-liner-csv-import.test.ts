import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ONE_LINER_CSV_HEADERS,
  ONE_LINER_REQUIRED_HEADERS,
  parseOneLinerCsvRow,
  validateOneLinerCsvHeaders,
} from "../../src/lib/questions/one-liner-csv-import.ts";

describe("one-liner CSV headers", () => {
  it("exposes expected headers", () => {
    assert.deepEqual([...ONE_LINER_CSV_HEADERS], ["title", "body", "subject", "status"]);
  });

  it("required headers are subset of all headers", () => {
    for (const h of ONE_LINER_REQUIRED_HEADERS) {
      assert.ok(
        (ONE_LINER_CSV_HEADERS as readonly string[]).includes(h),
        `${h} should be in ONE_LINER_CSV_HEADERS`
      );
    }
  });
});

describe("validateOneLinerCsvHeaders", () => {
  it("returns empty when all required headers present", () => {
    assert.deepEqual(validateOneLinerCsvHeaders(["title", "body"]), []);
  });

  it("returns missing required headers", () => {
    const missing = validateOneLinerCsvHeaders(["title"]);
    assert.ok(missing.includes("body"));
  });

  it("is case-insensitive", () => {
    assert.deepEqual(validateOneLinerCsvHeaders(["TITLE", "BODY"]), []);
  });

  it("returns both required when empty", () => {
    assert.deepEqual(validateOneLinerCsvHeaders([]).sort(), ["body", "title"]);
  });
});

describe("parseOneLinerCsvRow", () => {
  it("parses a valid draft row", () => {
    const row = parseOneLinerCsvRow({
      title: "Digoxin toxicity",
      body: "Key fact: xanthopsia, bradycardia.",
      subject: "Medicine",
      status: "draft",
    }, 1);
    assert.equal(row.title, "Digoxin toxicity");
    assert.equal(row.body, "Key fact: xanthopsia, bradycardia.");
    assert.equal(row.subject, "Medicine");
    assert.equal(row.status, "draft");
    assert.equal(row.client_errors, undefined);
  });

  it("parses published status", () => {
    const row = parseOneLinerCsvRow({ title: "T", body: "B", status: "published" }, 1);
    assert.equal(row.status, "published");
  });

  it("defaults to draft for unknown status", () => {
    const row = parseOneLinerCsvRow({ title: "T", body: "B", status: "active" }, 1);
    assert.equal(row.status, "draft");
  });

  it("errors on missing title", () => {
    const row = parseOneLinerCsvRow({ title: "", body: "B" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("title")));
  });

  it("errors on missing body", () => {
    const row = parseOneLinerCsvRow({ title: "T", body: "" }, 1);
    assert.ok(row.client_errors?.some((e) => e.includes("body")));
  });

  it("trims whitespace", () => {
    const row = parseOneLinerCsvRow({ title: "  T  ", body: "  B  " }, 1);
    assert.equal(row.title, "T");
    assert.equal(row.body, "B");
  });

  it("stores row_number", () => {
    const row = parseOneLinerCsvRow({ title: "T", body: "B" }, 7);
    assert.equal(row.row_number, 7);
  });
});
