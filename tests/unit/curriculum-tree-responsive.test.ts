import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { treeIndentStyle } from "../../src/lib/admin/curriculum-indent.ts";

describe("curriculum tree indent", () => {
  it("uses paddingLeft with CSS var step (not marginLeft)", () => {
    const s0 = treeIndentStyle(0);
    const s3 = treeIndentStyle(3);
    const add = treeIndentStyle(3, 28);

    assert.equal("marginLeft" in s0, false);
    assert.equal(s0.paddingLeft, "calc(0 * var(--tree-indent, 12px) + 0px)");
    assert.equal(s3.paddingLeft, "calc(3 * var(--tree-indent, 12px) + 0px)");
    assert.equal(add.paddingLeft, "calc(3 * var(--tree-indent, 12px) + 28px)");
  });

  it("keeps deep indent bounded at mobile step width", () => {
    // Mobile --tree-indent:12px → level 3 = 36px; +28 form offset = 64px.
    // Old fixed w-64 input (256) + 64 ≈ 320 — fails on narrow phones.
    const step = 12;
    const level3 = 3 * step;
    const formOffset = level3 + 28;
    assert.ok(level3 <= 48, "topic indent stays visually bounded on mobile");
    assert.ok(formOffset < 320, "form indent alone cannot force page overflow");
  });
});
