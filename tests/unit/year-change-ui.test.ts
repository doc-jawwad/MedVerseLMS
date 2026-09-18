import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canStudentSubmitYearChange,
  yearChangeErrorMessage,
  yearChangeStatusLabel,
} from "../../src/lib/year-changes/errors.ts";

describe("year change error mapping", () => {
  it("maps known codes without leaking internals", () => {
    assert.match(yearChangeErrorMessage("year_change_already_pending"), /pending/i);
    assert.match(yearChangeErrorMessage("same_year"), /different year/i);
    assert.match(yearChangeErrorMessage("permission_denied"), /permission/i);
    assert.equal(
      yearChangeErrorMessage("relation does not exist"),
      "Something went wrong. Please try again."
    );
  });
});

describe("year change student submit gate", () => {
  it("blocks when pending exists or enrollment missing", () => {
    assert.equal(
      canStudentSubmitYearChange({
        hasActiveEnrollment: true,
        hasPendingRequest: false,
      }),
      true
    );
    assert.equal(
      canStudentSubmitYearChange({
        hasActiveEnrollment: true,
        hasPendingRequest: true,
      }),
      false
    );
    assert.equal(
      canStudentSubmitYearChange({
        hasActiveEnrollment: false,
        hasPendingRequest: false,
      }),
      false
    );
  });

  it("labels statuses for UI", () => {
    assert.equal(yearChangeStatusLabel("pending"), "Pending review");
    assert.equal(yearChangeStatusLabel("rejected"), "Rejected");
  });
});
