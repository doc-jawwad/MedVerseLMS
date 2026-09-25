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
import { studentManageMenuItems } from "../../src/lib/admin/student-account-ui.ts";
import { subscriptionsNavHref } from "../../src/lib/admin/subscriptions-nav.ts";
import {
  APP_DISPLAY_TIMEZONE,
  formatDateTime,
} from "../../src/lib/utils.ts";

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
    assert.equal(ADMIN_PERMISSION_CATALOG.length, 17);
    assert.ok(
      ADMIN_PERMISSION_CATALOG.some((p) => p.code === "manage_curriculum")
    );
    assert.ok(ADMIN_PRESETS.some((p) => p.id === "academic"));
    assert.ok(ADMIN_PRESETS.some((p) => p.id === "operations"));
    assert.ok(codesForPreset("academic").includes("edit_questions"));
    assert.ok(codesForPreset("academic").includes("manage_curriculum"));
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
    assert.match(adminRbacErrorMessage("permission_denied"), /permission/i);
    assert.match(adminRbacErrorMessage("main_admin_required"), /Main Admin/i);
  });
});

describe("custom admin student Manage menu", () => {
  it("shows Restore only with activate_students", () => {
    const blocked = studentManageMenuItems({
      accountStatus: "restricted",
      hasActiveClass: true,
      hasYearForResources: true,
      permissions: ["view_students"],
    });
    assert.deepEqual(blocked.map((m) => m.id), []);

    const restore = studentManageMenuItems({
      accountStatus: "restricted",
      hasActiveClass: true,
      hasYearForResources: true,
      permissions: ["activate_students"],
    });
    assert.deepEqual(restore.map((m) => m.id), ["restore_lms"]);
  });

  it("shows block actions only with restrict_students", () => {
    const none = studentManageMenuItems({
      accountStatus: "active",
      hasActiveClass: true,
      hasYearForResources: false,
      permissions: ["view_students"],
    });
    assert.ok(!none.some((m) => m.id === "restrict_lms"));

    const block = studentManageMenuItems({
      accountStatus: "active",
      hasActiveClass: false,
      hasYearForResources: false,
      permissions: ["restrict_students"],
    });
    assert.ok(block.some((m) => m.id === "restrict_lms"));
    assert.ok(!block.some((m) => m.id === "promote_class"));
  });

  it("gates promote and resource access by permission", () => {
    const menu = studentManageMenuItems({
      accountStatus: "active",
      hasActiveClass: true,
      hasYearForResources: true,
      permissions: ["manage_year_changes", "grant_resource_access"],
    });
    assert.deepEqual(
      menu.map((m) => m.id).sort(),
      ["promote_class", "resource_access"].sort()
    );
  });
});

describe("subscriptions nav landing", () => {
  it("routes review-only and payment-only admins away from manage page", () => {
    assert.equal(
      subscriptionsNavHref(["manage_subscriptions"]),
      "/admin/subscriptions"
    );
    assert.equal(
      subscriptionsNavHref(["review_subscription_applications"]),
      "/admin/subscriptions/applications"
    );
    assert.equal(
      subscriptionsNavHref(["manage_payment_settings"]),
      "/admin/subscriptions/payment-settings"
    );
  });
});

describe("display timezone", () => {
  it("formats user-facing timestamps in Asia/Karachi (not UTC)", () => {
    assert.equal(APP_DISPLAY_TIMEZONE, "Asia/Karachi");
    // 2026-01-01T00:00:00Z → 05:00 in PKT
    const s = formatDateTime("2026-01-01T00:00:00.000Z");
    assert.match(s, /05:00:00/);
  });
});

describe("admin management wiring", () => {
  it("exposes an Admins nav item and page", () => {
    const nav = fs.readFileSync(
      path.join(root, "src/lib/admin/admin-nav.ts"),
      "utf8"
    );
    assert.match(nav, /\/admin\/admins/);
    assert.match(nav, /manage_admins/);
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
    assert.match(src, /main_admin_required/);
    assert.match(src, /set_main_admin/);
    assert.doesNotMatch(src, /from\("profiles"\)[\s\S]*update\(/);
  });

  it("requires Main Admin for set_main_admin in the staging migration", () => {
    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260925140000_admin_rbac_authority_fixes.sql"
      ),
      "utf8"
    );
    assert.match(mig, /main_admin_required/);
    assert.match(mig, /is_main_admin\(\)/);
    assert.match(mig, /publish_tests/);
    assert.match(mig, /has_permission\('publish_tests'\)/);
    assert.match(mig, /skipped_duplicate/);
    assert.match(mig, /can_admin_import_questions/);
    assert.ok(
      !/has_permission\('manage_tests'\)/.test(mig),
      "RPC must not check non-catalog manage_tests"
    );
  });

  it("seals direct is_main_admin UPDATE and curriculum writes in escalation migration", () => {
    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260925150000_admin_rbac_escalation_seal.sql"
      ),
      "utf8"
    );
    assert.match(mig, /protect_profile_gated_columns/);
    assert.match(mig, /not public\.is_main_admin\(\)/);
    assert.match(mig, /main_admin_required/);
    assert.match(mig, /manage_curriculum/);
    assert.match(mig, /years_admin_insert/);
    assert.match(mig, /pg_advisory_xact_lock/);
    assert.match(mig, /bootstrap_first_main_admin/);
    assert.ok(
      !/has_permission\('manage_admins'\)/.test(
        mig.slice(
          mig.indexOf("protect_profile_gated_columns"),
          mig.indexOf("protect_profile_role")
        )
      ),
      "is_main_admin trigger must not treat manage_admins as sufficient"
    );
  });

  it("gates curriculum nav and actions on manage_curriculum", () => {
    const nav = fs.readFileSync(
      path.join(root, "src/lib/admin/admin-nav.ts"),
      "utf8"
    );
    assert.match(nav, /\/admin\/curriculum/);
    assert.match(nav, /manage_curriculum/);
    const actions = fs.readFileSync(
      path.join(root, "src/lib/actions/curriculum.ts"),
      "utf8"
    );
    assert.match(actions, /manage_curriculum/);
    assert.match(actions, /requireCurriculumWrite/);
  });

  it("pearl create returns an id instead of redirecting", () => {
    const src = fs.readFileSync(
      path.join(root, "src/lib/actions/pearls.ts"),
      "utf8"
    );
    assert.match(src, /return \{ id: data\.id/);
    assert.doesNotMatch(
      src,
      /createPearlPoint[\s\S]*redirect\(`\/admin\/pearls\/\$\{data\.id\}`\)/
    );
  });
});
