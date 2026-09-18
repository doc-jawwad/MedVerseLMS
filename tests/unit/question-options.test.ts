import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { examOptionsFromRpc } from "../../src/lib/exam/question-options.ts";

describe("examOptionsFromRpc", () => {
  it("passes through the canonical {key,text} array", () => {
    const raw = [
      { key: "A", text: "Alpha" },
      { key: "B", text: "Bravo" },
      { key: "C", text: "Charlie" },
      { key: "D", text: "Delta" },
    ];
    assert.deepEqual(examOptionsFromRpc(raw), raw);
  });

  it("renders the staging start_attempt object shape (8JUI fixture)", () => {
    // Exact jsonb stored on medverse_staging question_versions for
    // test 91a4d4bf-ba97-4123-bf97-60fd2e675655 / start_attempt payload.
    const stagingOptions = {
      A: "Alpha",
      B: "Bravo",
      C: "Charlie",
      D: "Delta",
    };
    const mapped = examOptionsFromRpc(stagingOptions).map((o) => `${o.key}.${o.text}`);
    assert.deepEqual(mapped, ["A.Alpha", "B.Bravo", "C.Charlie", "D.Delta"]);
  });

  it("accepts a five-option key map in A–E order", () => {
    const raw = { A: "1", B: "2", C: "3", D: "4", E: "5" };
    assert.equal(examOptionsFromRpc(raw).length, 5);
    assert.equal(examOptionsFromRpc(raw)[4]?.key, "E");
  });

  it("rejects malformed payloads instead of inventing options", () => {
    assert.throws(() => examOptionsFromRpc(null));
    assert.throws(() => examOptionsFromRpc("A"));
    assert.throws(() => examOptionsFromRpc({}));
    assert.throws(() => examOptionsFromRpc({ A: "only", B: "three", C: "keys" }));
    assert.throws(() => examOptionsFromRpc({ A: "", B: "b", C: "c", D: "d" }));
    assert.throws(() => examOptionsFromRpc({ foo: "x", A: "a", B: "b", C: "c", D: "d" }));
    assert.throws(() =>
      examOptionsFromRpc([{ key: "A", text: "x" }, { key: "B", text: "y" }])
    );
  });
});
