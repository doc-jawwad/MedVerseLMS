import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitWidthScale } from "../../src/lib/study/pdf-fit-width.ts";

describe("pdf fit-width scale", () => {
  it("fits page into container width", () => {
    assert.equal(fitWidthScale(400, 200, 0), 2);
    assert.equal(fitWidthScale(408, 400, 8), 1);
  });

  it("clamps and guards invalid input", () => {
    assert.equal(fitWidthScale(40, 200, 0), 0.5); // MIN_SCALE
    assert.ok(fitWidthScale(2000, 100, 0) <= 4);
    assert.equal(fitWidthScale(0, 200), 1);
    assert.equal(fitWidthScale(400, 0), 1);
  });
});
