import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterMcqMoveDestinations,
  mcqBankMoveRevalidatePaths,
  mcqMoveDestinationLabel,
  type McqMoveDestination,
} from "../../src/lib/admin/mcq-bank-move.ts";

const dests: McqMoveDestination[] = [
  {
    subfolder_id: "sf-a1",
    name: "Sub A1",
    folder_id: "f-a",
    folder_name: "Folder A",
  },
  {
    subfolder_id: "sf-b1",
    name: "Sub B1",
    folder_id: "f-b",
    folder_name: "Folder B",
  },
];

describe("mcq move destinations", () => {
  it("labels folder + subfolder context", () => {
    assert.equal(mcqMoveDestinationLabel(dests[0]!), "Folder A / Sub A1");
  });

  it("excludes current subfolder but keeps cross-folder options", () => {
    const filtered = filterMcqMoveDestinations(dests, {
      excludeSubfolderId: "sf-a1",
    });
    assert.deepEqual(
      filtered.map((d) => d.subfolder_id),
      ["sf-b1"]
    );
  });

  it("single-subfolder folder still has cross-folder destinations", () => {
    const onlyOneLocal = filterMcqMoveDestinations(
      [
        {
          subfolder_id: "only",
          name: "Only",
          folder_id: "f-a",
          folder_name: "Folder A",
        },
        dests[1]!,
      ],
      { excludeSubfolderId: "only" }
    );
    assert.equal(onlyOneLocal.length, 1);
    assert.equal(onlyOneLocal[0]!.folder_id, "f-b");
  });
});

describe("mcq move revalidate paths", () => {
  it("includes source and destination folder + subfolder pages", () => {
    const paths = mcqBankMoveRevalidatePaths({
      productKey: "block-1",
      folderIds: ["folder-src"],
      subfolders: [
        { folderId: "folder-src", subfolderId: "sub-src" },
        { folderId: "folder-dst", subfolderId: "sub-dst" },
      ],
    });
    assert.ok(paths.includes("/admin/mcq-bank/block-1"));
    assert.ok(paths.includes("/admin/mcq-bank/block-1/folder-src"));
    assert.ok(paths.includes("/admin/mcq-bank/block-1/folder-dst"));
    assert.ok(paths.includes("/admin/mcq-bank/block-1/folder-src/sub-src"));
    assert.ok(paths.includes("/admin/mcq-bank/block-1/folder-dst/sub-dst"));
  });
});
