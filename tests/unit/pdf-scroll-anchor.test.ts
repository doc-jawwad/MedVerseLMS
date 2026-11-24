import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capturePdfScrollAnchor, restorePdfScrollAnchor } from "../../src/lib/study/pdf-scroll-anchor.ts";

describe("logical PDF scroll anchor", () => {
  const before = [{ top: 8, height: 800 }, { top: 816, height: 800 }, { top: 1624, height: 800 }];
  const after = [{ top: 8, height: 1000 }, { top: 1016, height: 400 }, { top: 1424, height: 800 }];

  it("preserves page identity and relative reading position across mixed-size corrections", () => {
    const anchor = capturePdfScrollAnchor(before, 916, 100)!;
    assert.deepEqual(anchor, { pageNumber: 2, position: "inside", offset: 0.25 });
    assert.equal(restorePdfScrollAnchor(after, anchor, 100, 2000), 1016);
  });

  it("preserves reading position on zoom without scaling fixed gaps", () => {
    const anchor = capturePdfScrollAnchor(before, 916, 100)!;
    const zoom = [{ top: 8, height: 1600 }, { top: 1616, height: 1600 }, { top: 3224, height: 1600 }];
    assert.equal(restorePdfScrollAnchor(zoom, anchor, 100, 4500), 1916);
  });

  it("preserves inter-page gaps and clamps a shrinking gap", () => {
    const anchor = capturePdfScrollAnchor(before, 812, 0)!;
    assert.deepEqual(anchor, { pageNumber: 1, position: "after", offset: 4 });
    assert.equal(restorePdfScrollAnchor(after, anchor, 0, 2000), 1012);
    assert.equal(restorePdfScrollAnchor([{ top: 8, height: 1000 }, { top: 1010, height: 400 }], anchor, 0, 2000), 1010);
  });

  it("handles padding, boundaries, and the end of the document", () => {
    const first = capturePdfScrollAnchor(before, 0, 0)!;
    assert.equal(restorePdfScrollAnchor(after, first, 0, 2000), 0);
    assert.equal(capturePdfScrollAnchor(before, 816, 0)?.pageNumber, 2);
    const last = capturePdfScrollAnchor(before, 2430, 0)!;
    assert.equal(restorePdfScrollAnchor(after, last, 0, 1800), 1800);
  });

  it("uses the current scroll position rather than an earlier pending target", () => {
    const anchor = capturePdfScrollAnchor(before, 1724, 100)!;
    assert.equal(anchor.pageNumber, 3);
    assert.equal(restorePdfScrollAnchor(after, anchor, 100, 2000), 1524);
  });

  it("does not restore missing pages or an empty document", () => {
    assert.equal(capturePdfScrollAnchor([], 0, 0), null);
    assert.equal(restorePdfScrollAnchor([], { pageNumber: 1, position: "inside", offset: 0 }, 0, 0), null);
  });
});
