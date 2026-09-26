import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { curriculumErrorMessage } from "../../src/lib/curriculum/errors.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("curriculum admin delete", () => {
  it("maps business codes to clear admin messages", () => {
    assert.match(
      curriculumErrorMessage("curriculum_has_questions"),
      /questions/i
    );
    assert.match(
      curriculumErrorMessage("curriculum_has_children"),
      /child/i
    );
    assert.match(
      curriculumErrorMessage("product_subject_protected"),
      /product subjects/i
    );
    assert.match(
      curriculumErrorMessage("permission_denied"),
      /permission/i
    );
  });

  it("routes delete through admin_delete_curriculum_node RPC", () => {
    const actions = fs.readFileSync(
      path.join(root, "src/lib/actions/curriculum.ts"),
      "utf8"
    );
    assert.match(actions, /admin_delete_curriculum_node/);
    assert.doesNotMatch(
      actions,
      /deleteCurriculumNode[\s\S]*\.from\(kind\)\.delete\(\)/
    );

    const tree = fs.readFileSync(
      path.join(root, "src/app/(admin)/admin/curriculum/curriculum-tree.tsx"),
      "utf8"
    );
    assert.match(tree, /curriculumErrorMessage/);
    assert.doesNotMatch(
      tree,
      /permanently deletes it and everything under it/i
    );
    assert.match(tree, /empty/);

    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260926090000_admin_delete_curriculum_node.sql"
      ),
      "utf8"
    );
    assert.match(mig, /curriculum_has_questions/);
    assert.match(mig, /curriculum_has_children/);
    assert.match(mig, /product_subject_protected/);
    assert.match(mig, /manage_curriculum/);
    // Must not open the Content Bin purge GUC from curriculum delete.
    assert.doesNotMatch(mig, /set_config\s*\(\s*'medverse\.allow_question_version_purge'/i);
    assert.doesNotMatch(mig, /delete\s+from\s+public\.questions/i);
  });
});
