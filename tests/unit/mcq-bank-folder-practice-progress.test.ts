import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completionPercent } from "../../src/lib/practice/engine.ts";
import {
  folderPracticeProgressLabel,
  normalizeFolderPracticeProgress,
} from "../../src/lib/practice/mcq-bank-folder-progress.ts";

describe("mcq bank folder practice progress helpers", () => {
  it("normalizes 0/10, partial, and 100% states", () => {
    const z = normalizeFolderPracticeProgress(
      { total: 10, done: 0, remaining: 10, percent_complete: 0, complete: false },
      "f1"
    );
    assert.equal(z.done, 0);
    assert.equal(z.total, 10);
    assert.equal(z.percent_complete, 0);
    assert.equal(z.complete, false);

    const mid = normalizeFolderPracticeProgress({
      folder_id: "f1",
      total: 10,
      done: 5,
      remaining: 5,
      percent_complete: 50,
      complete: false,
    });
    assert.equal(mid.percent_complete, 50);
    assert.equal(mid.complete, false);

    const full = normalizeFolderPracticeProgress({
      total: 10,
      done: 10,
      remaining: 0,
      percent_complete: 100,
      complete: true,
    });
    assert.equal(full.complete, true);
    assert.equal(full.percent_complete, 100);
  });

  it("matches completionPercent for ring labels", () => {
    assert.equal(completionPercent(0, 10), 0);
    assert.equal(completionPercent(1, 10), 10);
    assert.equal(completionPercent(5, 10), 50);
    assert.equal(completionPercent(9, 10), 90);
    assert.equal(completionPercent(10, 10), 100);
    assert.equal(folderPracticeProgressLabel({ done: 1, total: 10 }), "1/10");
  });
});
