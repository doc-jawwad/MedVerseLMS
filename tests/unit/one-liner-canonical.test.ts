import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { LIBRARY_META, parseLibrarySlug } from "../../src/lib/library/types.ts";
import { BLOCK_CATEGORIES } from "../../src/lib/academic-tree/product-structure.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("canonical One Liner surface", () => {
  it("student chrome labels One Liner and uses one-liner slug", () => {
    const cat = BLOCK_CATEGORIES.find((c) => c.id === "pearl_points");
    assert.ok(cat);
    assert.equal(cat.name, "One Liner");
    assert.equal(cat.slug, "one-liner");
    assert.equal(LIBRARY_META.pearl_points.label, "One Liner");
    assert.equal(LIBRARY_META.pearl_points.href, "/one-liner");
    assert.equal(parseLibrarySlug("one-liner"), "pearl_points");
    assert.equal(parseLibrarySlug("pearl-points"), "pearl_points");
  });

  it("keeps pearl_points store + optional PDF migration without dropping one_liners", () => {
    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260926130000_one_liner_canonical_pearl_pdf.sql"
      ),
      "utf8"
    );
    assert.match(mig, /authorize_pearl_object/);
    assert.match(mig, /has_source_pdf/);
    assert.match(mig, /study-content\//);
    assert.doesNotMatch(mig, /drop table\s+public\.one_liners/i);
    assert.doesNotMatch(mig, /drop table\s+public\.pearl_points/i);

    const actions = fs.readFileSync(
      path.join(root, "src/lib/actions/pearls.ts"),
      "utf8"
    );
    assert.match(actions, /attachPearlSourcePdf/);
    assert.match(actions, /allocateStudyObjectKey/);

    const tree = fs.readFileSync(
      path.join(root, "src/app/(student)/pearl-points/page.tsx"),
      "utf8"
    );
    assert.match(tree, /redirect\("\/one-liner"\)/);
  });
});
