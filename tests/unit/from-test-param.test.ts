import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFromTestId } from "../../src/lib/tests/from-test-param.ts";

describe("parseFromTestId", () => {
  it("accepts a uuid", () => {
    const id = "8b32610c-65d2-4b02-9521-bbfb7d5ed323";
    assert.equal(parseFromTestId(id), id);
  });

  it("rejects junk and arrays of junk", () => {
    assert.equal(parseFromTestId(undefined), null);
    assert.equal(parseFromTestId("not-a-uuid"), null);
    assert.equal(parseFromTestId(["nope"]), null);
  });
});
