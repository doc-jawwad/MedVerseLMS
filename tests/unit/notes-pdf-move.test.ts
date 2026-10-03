import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterNotesPdfMoveDestinations,
  notesPdfMoveErrorMessage,
  notesPdfMoveRevalidatePaths,
  type NotesPdfMoveDestination,
} from "../../src/lib/admin/notes-pdf-move.ts";

const dest = (
  partial: Partial<NotesPdfMoveDestination> & Pick<NotesPdfMoveDestination, "id" | "name">
): NotesPdfMoveDestination => ({
  year_id: "y1",
  library_type: "notes",
  content_surface: "academic",
  ...partial,
});

describe("notesPdfMove destinations", () => {
  it("excludes source folder and non-matching year/library/surface", () => {
    const filtered = filterNotesPdfMoveDestinations(
      [
        dest({ id: "src", name: "Source" }),
        dest({ id: "ok", name: "Same year notes" }),
        dest({ id: "books", name: "Books", library_type: "books" }),
        dest({ id: "y2", name: "Other year", year_id: "y2" }),
        dest({
          id: "ps",
          name: "Prof session",
          content_surface: "prof_session",
        }),
      ],
      { sourceFolderId: "src", yearId: "y1", contentSurface: "academic" }
    );
    assert.deepEqual(
      filtered.map((d) => d.id),
      ["ok"]
    );
  });

  it("treats null/missing content_surface as academic", () => {
    const filtered = filterNotesPdfMoveDestinations(
      [dest({ id: "legacy", name: "Legacy", content_surface: "" })],
      { sourceFolderId: "other", yearId: "y1" }
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.id, "legacy");
  });
});

describe("notesPdfMove revalidate paths", () => {
  it("includes admin materials, notes listings, and free-resources notes", () => {
    const paths = notesPdfMoveRevalidatePaths({
      sourceFolderId: "a",
      destFolderId: "b",
    });
    assert.ok(paths.includes("/admin/materials"));
    assert.ok(paths.includes("/notes"));
    assert.ok(paths.includes("/free-resources/notes"));
    assert.ok(paths.includes("/academic"));
    assert.ok(!paths.includes("/admin/mcq-bank"));
  });
});

describe("notesPdfMove error mapping", () => {
  it("maps year and library mismatches", () => {
    assert.match(
      notesPdfMoveErrorMessage("notes_move_year_mismatch"),
      /same class year/i
    );
    assert.match(
      notesPdfMoveErrorMessage("notes_move_library_type_mismatch"),
      /Notes folder/i
    );
    assert.match(
      notesPdfMoveErrorMessage("permission_denied"),
      /Manage materials/i
    );
  });
});

describe("notesPdfMove wiring contracts", () => {
  const actionSrc = readFileSync(
    join(process.cwd(), "src/lib/actions/materials.ts"),
    "utf8"
  );
  const mig = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261004010000_notes_pdf_material_move.sql"
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

  it("server action calls RPC and revalidates notes paths", () => {
    assert.match(actionSrc, /admin_move_notes_pdf_material/);
    assert.match(actionSrc, /notesPdfMoveRevalidatePaths/);
    assert.match(actionSrc, /export async function moveNotesPdfMaterial/);
  });

  it("RPC updates folder_id only and seals year/library/surface/live", () => {
    assert.match(mig, /set folder_id = p_dest_folder_id/);
    assert.match(mig, /library_type is distinct from 'notes'/);
    assert.match(mig, /notes_move_year_mismatch/);
    assert.match(mig, /notes_move_content_surface_mismatch/);
    assert.match(mig, /destination_folder_deleted/);
    assert.match(mig, /has_permission\('manage_materials'\)/);
    assert.match(mig, /admin_can_access_year/);
    assert.match(mig, /r2_object_key is distinct from v_key_before/);
    assert.doesNotMatch(mig, /enqueue_r2_purge/);
    assert.doesNotMatch(mig, /deleted_at\s*=\s*now\(\)/);
  });

  it("Notes admin UI exposes Move for PDFs without touching MCQ Bank", () => {
    assert.match(ui, /moveNotesPdfMaterial/);
    assert.match(ui, /libraryType === "notes"/);
    assert.match(ui, /Confirm move/);
    assert.doesNotMatch(ui, /mcq-bank|mcq_bank/);
  });
});
