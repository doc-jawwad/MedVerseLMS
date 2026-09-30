import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  FOLDER_LIBRARY_TYPES,
  LIBRARY_META,
  itemDeliveryModes,
  parseLibrarySlug,
} from "../../src/lib/library/types.ts";
import { BLOCK_CATEGORIES } from "../../src/lib/academic-tree/product-structure.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("canonical One Liner surface", () => {
  it("student chrome labels One Liner and uses PDF folder library type", () => {
    const cat = BLOCK_CATEGORIES.find((c) => c.id === "one_liner");
    assert.ok(cat);
    assert.equal(cat.name, "One Liner");
    assert.equal(cat.slug, "one-liner");
    assert.equal(LIBRARY_META.one_liner.label, "One Liner");
    assert.equal(LIBRARY_META.one_liner.href, "/one-liner");
    assert.equal(LIBRARY_META.one_liner.folderType, "one_liner");
    assert.equal(parseLibrarySlug("one-liner"), "one_liner");
    assert.equal(parseLibrarySlug("pearl-points"), "one_liner");
    assert.ok((FOLDER_LIBRARY_TYPES as readonly string[]).includes("one_liner"));
    assert.deepEqual(itemDeliveryModes("one_liner"), ["pdf"]);
  });

  it("routes student One Liner to MaterialLibraryPage, not Pearl Q&A", () => {
    const page = fs.readFileSync(
      path.join(root, "src/app/(student)/one-liner/page.tsx"),
      "utf8"
    );
    assert.match(page, /MaterialLibraryPage/);
    assert.match(page, /libraryType="one_liner"/);
    assert.doesNotMatch(page, /PearlPointsLibraryPage/);

    const block = fs.readFileSync(
      path.join(root, "src/components/academic/block-category-page.tsx"),
      "utf8"
    );
    assert.match(block, /"one_liner"/);
    assert.doesNotMatch(block, /PearlPointsLibraryPage/);

    const redirect = fs.readFileSync(
      path.join(root, "src/app/(student)/pearl-points/page.tsx"),
      "utf8"
    );
    assert.match(redirect, /redirect\("\/one-liner"\)/);
  });

  it("adds one_liner material folder migration without dropping legacy stores", () => {
    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261001010000_one_liner_folder_materials.sql"
      ),
      "utf8"
    );
    assert.match(mig, /'one_liner'/);
    assert.match(mig, /material_folders_one_liner_flat_check/);
    assert.match(mig, /material_folders_one_liner_subject_check/);
    assert.match(mig, /library_type', 'one_liner'/);
    assert.doesNotMatch(mig, /drop table\s+public\.one_liners/i);
    assert.doesNotMatch(mig, /drop table\s+public\.pearl_points/i);
  });
});
