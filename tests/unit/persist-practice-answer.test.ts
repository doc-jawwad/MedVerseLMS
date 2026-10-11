import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPracticeAnswerCommitLedger,
  mapPracticeAnswerRpcRow,
} from "../../src/lib/practice/persist-practice-answer.ts";

describe("persist practice answer mapping", () => {
  it("maps Check-answer feedback with secrets", () => {
    const mapped = mapPracticeAnswerRpcRow(
      {
        is_correct: false,
        correct_key: "B",
        explanation: "Because B",
        reference: "Ref",
      },
      true
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.isCorrect, false);
    assert.deepEqual(mapped.feedback, {
      isCorrect: false,
      correctKey: "B",
      explanation: "Because B",
      reference: "Ref",
    });
  });

  it("maps Next-without-Check as saved without correctness or secrets", () => {
    const mapped = mapPracticeAnswerRpcRow(
      {
        is_correct: null,
        correct_key: null,
        explanation: null,
        reference: null,
      },
      false
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.isCorrect, null);
    assert.equal(mapped.feedback, null);
  });

  it("rejects silent Next when is_correct leaks", () => {
    const mapped = mapPracticeAnswerRpcRow(
      {
        is_correct: true,
        correct_key: null,
        explanation: null,
        reference: null,
      },
      false
    );
    assert.equal(mapped.ok, false);
  });

  it("fails closed when Check feedback lacks correct_key", () => {
    const mapped = mapPracticeAnswerRpcRow(
      {
        is_correct: true,
        correct_key: null,
        explanation: null,
        reference: null,
      },
      true
    );
    assert.equal(mapped.ok, false);
  });

  it("fails closed on empty RPC payload", () => {
    const mapped = mapPracticeAnswerRpcRow(undefined, false);
    assert.equal(mapped.ok, false);
  });
});

describe("practice answer commit ledger", () => {
  it("counts each version once across Check and Next", () => {
    const ledger = createPracticeAnswerCommitLedger();
    assert.equal(ledger.commit("v1", "A", true), true);
    assert.equal(ledger.commit("v1", "A", true), false);
    assert.equal(ledger.has("v1"), true);
    assert.equal(ledger.commit("v2", "C", null), true);
    assert.equal(ledger.commit("v2", "C", false), false);
  });

  it("treats unanswered skip as no commit", () => {
    const ledger = createPracticeAnswerCommitLedger();
    assert.equal(ledger.has("v-skip"), false);
  });
});
