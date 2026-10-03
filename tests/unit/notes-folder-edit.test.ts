import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterNotesFolderSubjects,
  notesFolderEditErrorMessage,
  notesFolderEditRevalidatePaths,
} from "../../src/lib/admin/notes-folder-edit.ts";

describe("notes folder subject options", () => {
  it("keeps same-year subjects", () => {
    const filtered = filterNotesFolderSubjects(
      [
        { id: "s1", name: "Block 1", year_id: "y1" },
        { id: "s2", name: "Other year", year_id: "y2" },
      ],
      { yearId: "y1" }
    );
    assert.deepEqual(
      filtered.map((s) => s.id),
      ["s1"]
    );
  });
});

describe("notes folder edit paths and errors", () => {
  it("revalidates notes listings", () => {
    const paths = notesFolderEditRevalidatePaths();
    assert.ok(paths.includes("/admin/materials"));
    assert.ok(paths.includes("/notes"));
    assert.ok(!paths.includes("/admin/mcq-bank"));
  });

  it("maps subject year mismatch", () => {
    assert.match(
      notesFolderEditErrorMessage("notes_folder_subject_year_mismatch"),
      /same class year/i
    );
  });
});

describe("notes folder edit wiring", () => {
  const actionSrc = readFileSync(
    join(process.cwd(), "src/lib/actions/materials.ts"),
    "utf8"
  );
  const mig = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261004020000_notes_folder_rename_subject.sql"
    ),
    "utf8"
  );
  const ui = readFileSync(
    join(
      process.cwd(),
      "src/app/(admin)/admin/materials/materials-admin.tsx"
    ),
    "utf8"
  );

  it("action calls RPC and revalidates", () => {
    assert.match(actionSrc, /admin_update_notes_folder/);
    assert.match(actionSrc, /notesFolderEditRevalidatePaths/);
    assert.match(actionSrc, /export async function updateNotesFolder/);
  });

  it("RPC seals notes-only year/subject and leaves materials untouched", () => {
    assert.match(mig, /library_type is distinct from 'notes'/);
    assert.match(mig, /notes_folder_subject_year_mismatch/);
    assert.match(mig, /has_permission\('manage_materials'\)/);
    assert.match(mig, /admin_can_access_year/);
    assert.doesNotMatch(mig, /update public\.materials/);
    assert.doesNotMatch(mig, /enqueue_r2_purge/);
    assert.doesNotMatch(mig, /deleted_at\s*=\s*now\(\)/);
  });

  it("Notes UI exposes Rename and Change subject", () => {
    assert.match(ui, /updateNotesFolder/);
    assert.match(ui, /Change subject/);
    assert.match(ui, /Save name/);
    assert.match(ui, /Save subject/);
  });
});
