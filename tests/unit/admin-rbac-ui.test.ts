import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_PRESETS,
  adminRbacErrorMessage,
  canDemoteAdmin,
  canDisableAdmin,
  codesForPreset,
  countActiveMainAdmins,
  isLastActiveMainAdmin,
  type AdminAccountRow,
} from "../../src/lib/admin/admin-rbac-ui.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function row(
  partial: Partial<AdminAccountRow> & Pick<AdminAccountRow, "id">
): AdminAccountRow {
  return {
    full_name: "A",
    email: `${partial.id}@test.invalid`,
    account_status: "active",
    is_main_admin: false,
    last_login_at: null,
    permission_codes: [],
    ...partial,
  };
}

describe("admin RBAC UI helpers", () => {
  it("covers the seeded permission catalog", () => {
    assert.equal(ADMIN_PERMISSION_CATALOG.length, 16);
    assert.ok(ADMIN_PRESETS.some((p) => p.id === "academic"));
    assert.ok(ADMIN_PRESETS.some((p) => p.id === "operations"));
    assert.ok(codesForPreset("academic").includes("edit_questions"));
    assert.ok(!codesForPreset("academic").includes("manage_students"));
  });

  it("protects the last active Main Admin from disable and demote", () => {
    const rows = [
      row({ id: "m1", is_main_admin: true }),
      row({ id: "a1", permission_codes: ["edit_questions"] }),
    ];
    assert.equal(countActiveMainAdmins(rows), 1);
    assert.equal(isLastActiveMainAdmin(rows, "m1"), true);
    assert.equal(canDisableAdmin(rows, "m1"), false);
    assert.equal(canDemoteAdmin(rows, "m1"), false);
    assert.equal(canDisableAdmin(rows, "a1"), true);
    assert.equal(canDemoteAdmin(rows, "a1"), true);
  });

  it("allows disabling a Main Admin when another active Main Admin remains", () => {
    const rows = [
      row({ id: "m1", is_main_admin: true }),
      row({ id: "m2", is_main_admin: true }),
    ];
    assert.equal(canDisableAdmin(rows, "m1"), true);
    assert.equal(canDemoteAdmin(rows, "m1"), true);
  });

  it("does not treat a blocked Main Admin as the last active Main Admin", () => {
    const rows = [
      row({ id: "m1", is_main_admin: true, account_status: "suspended" }),
      row({ id: "m2", is_main_admin: true }),
    ];
    assert.equal(isLastActiveMainAdmin(rows, "m1"), false);
    assert.equal(isLastActiveMainAdmin(rows, "m2"), true);
  });

  it("maps lockout errors to plain language", () => {
    assert.match(
      adminRbacErrorMessage("cannot disable the last active Main Admin"),
      /last active Main Admin/i
    );
    assert.match(
      adminRbacErrorMessage("permission_denied"),
      /permission/i
    );
  });
});

describe("admin management wiring", () => {
  it("exposes an Admins nav item and page", () => {
    const layout = fs.readFileSync(
      path.join(root, "src/app/(admin)/admin/layout.tsx"),
      "utf8"
    );
    assert.match(layout, /\/admin\/admins/);
    assert.ok(
      fs.existsSync(path.join(root, "src/app/(admin)/admin/admins/page.tsx"))
    );
  });

  it("creates Auth users with the Admin API and promotes via RPC, not a service PATCH", () => {
    const src = fs.readFileSync(
      path.join(root, "src/lib/actions/admins.ts"),
      "utf8"
    );
    assert.match(src, /createAdminClient/);
    assert.match(src, /auth\.admin\.createUser/);
    assert.match(src, /ensure_profile/);
    assert.match(src, /set_admin_role/);
    assert.match(src, /grant_admin_permission/);
    assert.doesNotMatch(src, /from\("profiles"\)[\s\S]*update\(/);
  });
});
