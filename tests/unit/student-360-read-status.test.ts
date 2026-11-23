import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchAllPages,
  unavailableSections,
} from "../../src/lib/admin/student-360/read-status.ts";

describe("Student 360 read status", () => {
  it("pages through every row beyond the PostgREST cap", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const res = await fetchAllPages<number>(async (from, to) => ({
      data: all.slice(from, to + 1),
      error: null,
    }));
    assert.equal(res.ok, true);
    assert.equal(res.data.length, 2500);
  });

  it("an exact multiple of the page size terminates", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => i);
    const res = await fetchAllPages<number>(async (from, to) => ({
      data: all.slice(from, to + 1),
      error: null,
    }));
    assert.equal(res.ok, true);
    assert.equal(res.data.length, 2000);
  });

  it("a failed page reports not ok and returns no partial data", async () => {
    let n = 0;
    const res = await fetchAllPages<number>(async () =>
      n++ === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { message: "denied for student 123" } }
    );
    assert.equal(res.ok, false);
    assert.deepEqual(res.data, []);
  });

  it("exceeding the page bound is unavailable, not truncated", async () => {
    const res = await fetchAllPages<number>(
      async () => ({ data: [1, 2], error: null }),
      { pageSize: 2, maxPages: 3 }
    );
    assert.equal(res.ok, false);
  });

  it("marks only visible failed sections unavailable", () => {
    const out = unavailableSections(["class", "practice", "subscription"], {
      practice: true,
      analytics: true,
    });
    assert.deepEqual(out, ["practice"]);
  });
});
