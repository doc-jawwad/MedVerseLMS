import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "supabase", "tests");
const helpers = readFileSync(path.join(dir, "000_helpers.sql"), "utf8");

describe("pgTAP fixtures work on Cloud-Auth schema and the VPS auth.users stub", () => {
  it("only test_helpers.create_user inserts into auth.users, behind an instance_id probe", () => {
    const parts = helpers.split(/create or replace function /);
    const withInsert = parts.filter((p) => /insert into auth\.users/.test(p));
    assert.equal(withInsert.length, 1);
    assert.match(withInsert[0], /^test_helpers\.create_user\(/);
    assert.match(withInsert[0], /column_name = 'instance_id'/);
    // stub branch inserts the equivalent profile row
    assert.match(withInsert[0], /else\s+insert into public\.profiles/);
  });
  it("student/admin/limited-admin factories go through create_user", () => {
    for (const fn of ["make_student", "make_admin", "make_limited_admin"]) {
      const body = helpers.split(`function test_helpers.${fn}(`)[1]?.split(/\$\$;/)[0] ?? "";
      assert.match(body, /test_helpers\.create_user\(/, fn);
      assert.doesNotMatch(body, /insert into auth\.users/, fn);
    }
  });
  it("no other suite inserts GoTrue columns into auth.users", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql") && n !== "000_helpers.sql")) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      assert.doesNotMatch(sql, /insert into auth\.users/i, f);
      assert.doesNotMatch(sql, /instance_id/i, f);
    }
  });
});
