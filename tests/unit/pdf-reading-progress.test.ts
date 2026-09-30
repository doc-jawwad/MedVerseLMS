import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPage } from "../../src/lib/study/pdf-page-clamp.ts";

describe("pdf reading progress helpers", () => {
  it("clamps page to [1, pageCount]", () => {
    assert.equal(clampPage(15, 20), 15);
    assert.equal(clampPage(0, 20), 1);
    assert.equal(clampPage(-3, 20), 1);
    assert.equal(clampPage(99, 20), 20);
    assert.equal(clampPage(1.9, 20), 1);
    assert.equal(clampPage(NaN, 20), 1);
    assert.equal(clampPage(5, 0), 1);
  });
});
