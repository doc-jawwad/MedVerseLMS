import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { readPdfOutline } from "../../src/lib/study/pdf-outline.ts";

type Doc = Parameters<typeof readPdfOutline>[0];
const stub = (methods: Record<string, unknown>) => methods as unknown as Doc;

describe("optional PDF outline", () => {
  it("resolves named and direct destinations and skips invalid nodes", async () => {
    const doc = stub({
      getOutline: async () => [
        { title: "Named", dest: "chapter" },
        { title: "Direct", dest: ["page2"] },
        { title: "Bad", dest: ["bad"] },
      ],
      getDestination: async () => ["page4"],
      getPageIndex: async (ref: string) => {
        if (ref === "bad") throw new Error("bad destination");
        return ref === "page4" ? 3 : 1;
      },
    });
    assert.deepEqual(await readPdfOutline(doc, () => true), [
      { title: "Named", pageNumber: 4 },
      { title: "Direct", pageNumber: 2 },
    ]);
  });

  it("discards stale results before resolving destinations", async () => {
    let current = true;
    let finish!: (value: unknown) => void;
    let destinationCalls = 0;
    const doc = stub({
      getOutline: () => new Promise((resolve) => { finish = resolve; }),
      getDestination: async () => { destinationCalls++; return ["page"]; },
      getPageIndex: async () => 0,
    });
    const pending = readPdfOutline(doc, () => current);
    current = false;
    finish([{ title: "Old document", dest: "old" }]);
    assert.equal(await pending, null);
    assert.equal(destinationCalls, 0);
  });

  it("returns an empty outline when optional metadata fails", async () => {
    const doc = stub({ getOutline: async () => { throw new Error("unavailable"); } });
    assert.deepEqual(await readPdfOutline(doc, () => true), []);
  });

  it("keeps outline work out of the initial viewer loading gate", () => {
    const viewer = readFileSync("src/components/study/pdf-viewer.tsx", "utf8");
    assert.match(viewer, /setLoading\(false\);\s*void readPdfOutline\(/);
    assert.match(viewer, /items !== null && gen === loadGenRef\.current/);
    assert.match(viewer, /Promise\.all\(\[\s*loadingTask\.promise,\s*loadPdfReadingPage\(materialId\)/);
  });
});
