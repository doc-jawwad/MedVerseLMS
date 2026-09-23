import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nestFolders,
  type FolderRow,
  type MaterialRow,
} from "../../src/lib/library/folder-tree.ts";

function folder(
  partial: Partial<FolderRow> & Pick<FolderRow, "id" | "name">
): FolderRow {
  return {
    description: null,
    year_id: "y1",
    subject_id: null,
    parent_id: null,
    sort_order: 0,
    entitlement: "any_subscription",
    library_type: "past_papers",
    ...partial,
  };
}

function material(
  partial: Partial<MaterialRow> & Pick<MaterialRow, "id" | "folder_id" | "title">
): MaterialRow {
  return {
    description: null,
    file_type: "pdf",
    kind: "pdf",
    status: "published",
    ...partial,
  };
}

describe("nestFolders", () => {
  it("nests Sub-Sub under Sub Nav and attaches materials", () => {
    const folders = [
      folder({ id: "root-b", name: "B", sort_order: 1 }),
      folder({ id: "root-a", name: "A", sort_order: 0 }),
      folder({
        id: "child-1",
        name: "Child",
        parent_id: "root-a",
        sort_order: 0,
      }),
    ];
    const materials = [
      material({ id: "m1", folder_id: "root-a", title: "Root PDF" }),
      material({ id: "m2", folder_id: "child-1", title: "Child PDF" }),
    ];

    const tree = nestFolders(folders, materials, "past_papers");
    assert.equal(tree.length, 2);
    assert.equal(tree[0].id, "root-a");
    assert.equal(tree[1].id, "root-b");
    assert.equal(tree[0].children.length, 1);
    assert.equal(tree[0].children[0].id, "child-1");
    assert.equal(tree[0].materials.length, 1);
    assert.equal(tree[0].materials[0].title, "Root PDF");
    assert.equal(tree[0].children[0].materials[0].title, "Child PDF");
  });

  it("filters by library_type and treats orphans as roots", () => {
    const folders = [
      folder({ id: "keep", name: "Keep" }),
      folder({
        id: "other",
        name: "Other",
        library_type: "notes",
      }),
      folder({
        id: "orphan",
        name: "Orphan",
        parent_id: "missing-parent",
      }),
    ];
    const tree = nestFolders(folders, [], "past_papers");
    assert.equal(tree.length, 2);
    assert.deepEqual(
      tree.map((n) => n.id).sort(),
      ["keep", "orphan"]
    );
  });

  it("sorts siblings by sort_order then name", () => {
    const folders = [
      folder({ id: "c", name: "C", sort_order: 0 }),
      folder({ id: "a", name: "A", sort_order: 0 }),
      folder({ id: "b", name: "B", sort_order: 1 }),
    ];
    const tree = nestFolders(folders, [], "past_papers");
    assert.deepEqual(
      tree.map((n) => n.id),
      ["a", "c", "b"]
    );
  });
});
