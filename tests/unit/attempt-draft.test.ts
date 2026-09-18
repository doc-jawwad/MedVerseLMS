import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeDraftAnswer,
  attemptDraftStorageKey,
  emptyAttemptDraft,
  maxSeqAmong,
  mergeServerAndLocalAnswers,
  parseAttemptDraft,
  serializeAttemptDraft,
  upsertDraftAnswer,
  type AttemptDraft,
  type ServerAnswerRow,
} from "../../src/lib/exam/attempt-draft.ts";

const Q1 = "11111111-1111-1111-1111-111111111111";
const Q2 = "22222222-2222-2222-2222-222222222222";
const ATTEMPT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("attempt draft serialization", () => {
  it("round-trips a minimal draft", () => {
    const draft: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q1]: {
          question_version_id: Q1,
          selected_key: "C",
          marked_for_review: true,
          seq: 25,
        },
      },
    };
    const parsed = parseAttemptDraft(serializeAttemptDraft(draft), ATTEMPT);
    assert.deepEqual(parsed, draft);
  });

  it("uses medverse_attempt:{attemptId} key", () => {
    assert.equal(attemptDraftStorageKey(ATTEMPT), `medverse_attempt:${ATTEMPT}`);
  });

  it("rejects corrupt JSON", () => {
    assert.equal(parseAttemptDraft("{"), null);
    assert.equal(parseAttemptDraft("null"), null);
    assert.equal(parseAttemptDraft("[]"), null);
  });

  it("rejects wrong attempt id and protected content rows", () => {
    const bad = JSON.stringify({
      v: 1,
      attempt_id: "other",
      answers: {},
    });
    assert.equal(parseAttemptDraft(bad, ATTEMPT), null);

    const withStem = JSON.stringify({
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q1]: {
          question_version_id: Q1,
          selected_key: "A",
          marked_for_review: false,
          seq: 1,
          stem: "secret",
        },
      },
    });
    const parsed = parseAttemptDraft(withStem, ATTEMPT);
    assert.ok(parsed);
    assert.equal(Object.keys(parsed.answers).length, 0);
  });
});

describe("upsertDraftAnswer / lifecycle", () => {
  it("coalesces rapid A→B→C to highest seq only", () => {
    let d = emptyAttemptDraft(ATTEMPT);
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "A",
      marked_for_review: false,
      seq: 10,
    });
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "B",
      marked_for_review: false,
      seq: 11,
    });
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "C",
      marked_for_review: false,
      seq: 12,
    });
    assert.equal(d.answers[Q1].selected_key, "C");
    assert.equal(d.answers[Q1].seq, 12);
  });

  it("never lets an older seq overwrite a newer local answer", () => {
    let d = emptyAttemptDraft(ATTEMPT);
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "D",
      marked_for_review: false,
      seq: 20,
    });
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "A",
      marked_for_review: false,
      seq: 19,
    });
    assert.equal(d.answers[Q1].selected_key, "D");
    assert.equal(d.answers[Q1].seq, 20);
  });

  it("removes acknowledged draft entries; keeps newer mid-flight", () => {
    let d = emptyAttemptDraft(ATTEMPT);
    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "A",
      marked_for_review: false,
      seq: 5,
    });
    d = acknowledgeDraftAnswer(d, Q1, 5);
    assert.equal(d.answers[Q1], undefined);

    d = upsertDraftAnswer(d, {
      question_version_id: Q1,
      selected_key: "B",
      marked_for_review: false,
      seq: 7,
    });
    d = acknowledgeDraftAnswer(d, Q1, 6);
    assert.equal(d.answers[Q1].seq, 7);
  });
});

describe("mergeServerAndLocalAnswers", () => {
  const server: ServerAnswerRow[] = [
    {
      question_version_id: Q1,
      selected_key: "A",
      marked_for_review: false,
      save_seq: 24,
    },
  ];

  it("restores local-ahead answer and flags flush", () => {
    const local: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q1]: {
          question_version_id: Q1,
          selected_key: "C",
          marked_for_review: true,
          seq: 25,
        },
      },
    };
    const merged = mergeServerAndLocalAnswers(server, local);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].selected_key, "C");
    assert.equal(merged[0].seq, 25);
    assert.equal(merged[0].needsFlush, true);
  });

  it("keeps server when server seq is higher", () => {
    const local: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q1]: {
          question_version_id: Q1,
          selected_key: "Z",
          marked_for_review: false,
          seq: 10,
        },
      },
    };
    const merged = mergeServerAndLocalAnswers(server, local);
    assert.equal(merged[0].selected_key, "A");
    assert.equal(merged[0].seq, 24);
    assert.equal(merged[0].needsFlush, false);
  });

  it("equal seq prefers server", () => {
    const local: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q1]: {
          question_version_id: Q1,
          selected_key: "Z",
          marked_for_review: true,
          seq: 24,
        },
      },
    };
    const merged = mergeServerAndLocalAnswers(server, local);
    assert.equal(merged[0].selected_key, "A");
    assert.equal(merged[0].needsFlush, false);
  });

  it("includes local-only questions for flush", () => {
    const local: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q2]: {
          question_version_id: Q2,
          selected_key: "B",
          marked_for_review: false,
          seq: 30,
        },
      },
    };
    const merged = mergeServerAndLocalAnswers(server, local);
    assert.equal(merged.length, 2);
    const q2 = merged.find((m) => m.question_version_id === Q2)!;
    assert.equal(q2.needsFlush, true);
    assert.equal(q2.selected_key, "B");
  });

  it("survives null/missing local draft", () => {
    const merged = mergeServerAndLocalAnswers(server, null);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].needsFlush, false);
  });

  it("maxSeqAmong covers server and local", () => {
    const local: AttemptDraft = {
      v: 1,
      attempt_id: ATTEMPT,
      answers: {
        [Q2]: {
          question_version_id: Q2,
          selected_key: null,
          marked_for_review: true,
          seq: 40,
        },
      },
    };
    assert.equal(maxSeqAmong(server, local), 40);
    assert.equal(maxSeqAmong(server, null), 24);
  });
});

describe("draft privacy shape", () => {
  it("serialized draft has no protected exam fields", () => {
    const draft = upsertDraftAnswer(emptyAttemptDraft(ATTEMPT), {
      question_version_id: Q1,
      selected_key: "A",
      marked_for_review: false,
      seq: 1,
    });
    const json = serializeAttemptDraft(draft);
    assert.equal(json.includes("stem"), false);
    assert.equal(json.includes("options"), false);
    assert.equal(json.includes("correct_key"), false);
    assert.equal(json.includes("explanation"), false);
    assert.equal(json.includes("score"), false);
  });
});
