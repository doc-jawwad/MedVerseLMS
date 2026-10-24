import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

describe("Prof. Session one_liner optional source PDF", () => {
  it("migration adds r2 columns, authorize RPC, and grant hardening", () => {
    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261024120000_one_liner_source_pdf.sql"
      ),
      "utf8"
    );
    assert.match(mig, /authorize_one_liner_object/);
    assert.match(mig, /get_one_liner_for_admin/);
    assert.match(mig, /has_source_pdf/);
    assert.match(mig, /one_liners_r2_payload_check/);
    assert.match(mig, /revoke select on public\.one_liners/);
    assert.match(mig, /grant select \(/);
    assert.doesNotMatch(
      mig,
      /grant select \(\s*[\s\S]*r2_object_key[\s\S]*\) on public\.one_liners/
    );
    assert.match(mig, /enqueue_r2_purge_if_unreferenced\(v_r2, 'one_liner'/);
    assert.match(
      mig,
      /select 1 from public\.one_liners ol where ol\.r2_object_key/
    );
  });

  it("CMS editor and student slot wire PDF attach and open link", () => {
    const editor = fs.readFileSync(
      path.join(
        root,
        "src/app/(admin)/admin/one-liners/one-liner-editor.tsx"
      ),
      "utf8"
    );
    assert.match(editor, /attachOneLinerSourcePdf/);
    assert.match(editor, /clearOneLinerSourcePdf/);
    assert.match(editor, /one-liner-source-pdf/);

    const actions = fs.readFileSync(
      path.join(root, "src/lib/actions/one-liners.ts"),
      "utf8"
    );
    assert.match(actions, /allocateStudyObjectKey/);
    assert.match(actions, /get_one_liner_for_admin/);

    const api = fs.readFileSync(
      path.join(root, "src/app/api/one-liners/[id]/route.ts"),
      "utf8"
    );
    assert.match(api, /authorize_one_liner_object/);
    assert.match(api, /getR2Object/);

    const slot = fs.readFileSync(
      path.join(root, "src/components/academic/prof-session-slot-page.tsx"),
      "utf8"
    );
    assert.match(slot, /has_source_pdf/);
    assert.match(slot, /\/api\/one-liners\/\$\{row\.id\}/);
    assert.match(slot, /one-liner-source-pdf-link/);
  });

  it("does not route day One-Liners through MaterialLibraryPage", () => {
    const slot = fs.readFileSync(
      path.join(root, "src/components/academic/prof-session-slot-page.tsx"),
      "utf8"
    );
    const oneLinersBlock = slot.slice(
      slot.indexOf('slotId === "one_liners"'),
      slot.indexOf('slotId === "practice_mcqs"')
    );
    assert.doesNotMatch(oneLinersBlock, /MaterialLibraryPage/);
  });
});
