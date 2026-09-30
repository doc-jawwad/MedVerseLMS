import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completionPercent } from "../../src/lib/practice/engine.ts";
import {
  folderPracticeProgressLabel,
  normalizeFolderPracticeProgress,
  normalizeSubfolderPracticeProgress,
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
    assert.equal(z.favorites, 0);
    assert.equal(z.incorrect, 0);

    const mid = normalizeFolderPracticeProgress({
      folder_id: "f1",
      total: 10,
      done: 5,
      remaining: 5,
      percent_complete: 50,
      complete: false,
      favorites: 2,
      incorrect: 3,
    });
    assert.equal(mid.percent_complete, 50);
    assert.equal(mid.complete, false);
    assert.equal(mid.favorites, 2);
    assert.equal(mid.incorrect, 3);

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

  it("normalizes subfolder progress with subfolder_id", () => {
    const p = normalizeSubfolderPracticeProgress(
      {
        subfolder_id: "sf1",
        total: 8,
        done: 3,
        remaining: 5,
        percent_complete: 38,
        complete: false,
        favorites: 1,
        incorrect: 2,
      },
      "sf-fallback"
    );
    assert.equal(p.subfolder_id, "sf1");
    assert.equal(p.done, 3);
    assert.equal(p.total, 8);
    assert.equal(p.favorites, 1);
    assert.equal(p.incorrect, 2);
    assert.equal(p.complete, false);

    const fallback = normalizeSubfolderPracticeProgress(
      { total: 2, done: 2 },
      "sf2"
    );
    assert.equal(fallback.subfolder_id, "sf2");
    assert.equal(fallback.complete, true);
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
