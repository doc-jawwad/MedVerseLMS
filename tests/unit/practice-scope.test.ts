import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRACTICE_SCOPE_TYPES,
  isPracticeScopeType,
} from "../../src/lib/practice/types.ts";
import {
  parsePracticeScopeParam,
  practiceBatchAccessMessage,
} from "../../src/lib/practice/scope.ts";

describe("practice scope types", () => {
  it("includes prof_session_day", () => {
    assert.ok(PRACTICE_SCOPE_TYPES.includes("prof_session_day"));
    assert.equal(isPracticeScopeType("prof_session_day"), true);
    assert.equal(isPracticeScopeType("subject"), true);
    assert.equal(isPracticeScopeType("chapter"), true);
    assert.equal(isPracticeScopeType("invalid"), false);
  });

  it("parsePracticeScopeParam accepts known scopes only", () => {
    assert.equal(parsePracticeScopeParam("prof_session_day"), "prof_session_day");
    assert.equal(parsePracticeScopeParam("topic"), "topic");
    assert.equal(parsePracticeScopeParam(undefined), null);
    assert.equal(parsePracticeScopeParam("exam"), null);
  });
});

describe("practiceBatchAccessMessage", () => {
  it("maps day and access errors", () => {
    assert.match(
      practiceBatchAccessMessage("practice_access_denied"),
      /don't have practice access/i
    );
    assert.match(
      practiceBatchAccessMessage("day_not_published"),
      /not published/i
    );
    assert.match(
      practiceBatchAccessMessage("day_not_found"),
      /not found/i
    );
    assert.match(
      practiceBatchAccessMessage("subject_id_required"),
      /subject link/i
    );
    assert.match(
      practiceBatchAccessMessage("something else"),
      /Could not load practice/i
    );
  });
});
