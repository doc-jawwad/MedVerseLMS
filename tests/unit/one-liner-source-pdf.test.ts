import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  discardKeysAfterAttachUpdate,
  discardKeysAfterClearUpdate,
  interpretMaybeSingleUpdate,
} from "../../src/lib/study/one-liner-source-pdf-update.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("one_liner source PDF update row confirmation", () => {
  it("treats maybeSingle null data as a zero-row failure", () => {
    assert.deepEqual(interpretMaybeSingleUpdate(null, null), {
      ok: false,
      reason: "zero_rows",
    });
    assert.deepEqual(interpretMaybeSingleUpdate(null, undefined), {
      ok: false,
      reason: "zero_rows",
    });
  });

  it("treats PostgREST error as failure even when data is present", () => {
    assert.deepEqual(
      interpretMaybeSingleUpdate(
        { id: "a" },
        { message: "permission_denied" }
      ),
      {
        ok: false,
        reason: "error",
        error: { message: "permission_denied" },
      }
    );
  });

  it("accepts exactly one returned id as success", () => {
    assert.deepEqual(interpretMaybeSingleUpdate({ id: "ol-1" }, null), {
      ok: true,
      id: "ol-1",
    });
  });

  it("on attach zero-row/error discards only the new key, never the previous", () => {
    assert.deepEqual(
      discardKeysAfterAttachUpdate({
        updateOk: false,
        newKey: "study-content/new",
        previousKey: "study-content/old",
      }),
      ["study-content/new"]
    );
    assert.deepEqual(
      discardKeysAfterAttachUpdate({
        updateOk: false,
        newKey: "study-content/new",
        previousKey: null,
      }),
      ["study-content/new"]
    );
  });

  it("on attach success discards previous key only when replaced", () => {
    assert.deepEqual(
      discardKeysAfterAttachUpdate({
        updateOk: true,
        newKey: "study-content/new",
        previousKey: "study-content/old",
      }),
      ["study-content/old"]
    );
    assert.deepEqual(
      discardKeysAfterAttachUpdate({
        updateOk: true,
        newKey: "study-content/new",
        previousKey: null,
      }),
      []
    );
  });

  it("on clear zero-row/error preserves the previous object", () => {
    assert.deepEqual(
      discardKeysAfterClearUpdate({
        updateOk: false,
        previousKey: "study-content/old",
      }),
      []
    );
  });

  it("on clear success discards the previous object when present", () => {
    assert.deepEqual(
      discardKeysAfterClearUpdate({
        updateOk: true,
        previousKey: "study-content/old",
      }),
      ["study-content/old"]
    );
    assert.deepEqual(
      discardKeysAfterClearUpdate({
        updateOk: true,
        previousKey: null,
      }),
      []
    );
  });
});

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

    const subMig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261024140000_one_liner_pdf_require_live_subscription.sql"
      ),
      "utf8"
    );
    assert.match(subMig, /has_live_subscription\(\)/);
    assert.match(subMig, /authorize_one_liner_object/);
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
    assert.match(actions, /interpretMaybeSingleUpdate/);
    assert.match(actions, /discardKeysAfterAttachUpdate/);
    assert.match(actions, /discardKeysAfterClearUpdate/);
    assert.match(actions, /\.select\("id"\)/);
    assert.match(actions, /\.maybeSingle\(\)/);
    assert.match(actions, /one_liner_not_updated/);

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
