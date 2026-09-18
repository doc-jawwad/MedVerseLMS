import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ACCOUNT_FILTERS,
  BLOCKING_ACCOUNT_ACTIONS,
  EXAM_DISPOSITIONS,
  FORBIDDEN_ENROLLMENT_LMS_GATE_IDS,
  accountStatusErrorMessage,
  accountStatusLabel,
  canSubmitAccountStatusChange,
  enrollmentClassLabel,
  matchesAccountFilter,
  pickLiveEnrollment,
  requiresExamDisposition,
  studentManageMenuItems,
} from "../../src/lib/admin/student-account-ui.ts";

describe("admin student account UI helpers", () => {
  it("labels LMS access separately from class rows", () => {
    assert.equal(accountStatusLabel("active"), "Can use LMS");
    assert.equal(accountStatusLabel("restricted"), "Restricted");
    assert.equal(accountStatusLabel("suspended"), "Suspended");
    assert.equal(enrollmentClassLabel("active"), "Current class");
    assert.equal(enrollmentClassLabel("expired"), "Previous class");
    assert.equal(enrollmentClassLabel("pending"), "Historical class row");
    assert.doesNotMatch(enrollmentClassLabel("suspended"), /LMS/i);
  });

  it("filters by account status, not enrollment pending", () => {
    assert.equal(matchesAccountFilter("restricted", "blocked"), true);
    assert.equal(matchesAccountFilter("active", "blocked"), false);
    assert.ok(ACCOUNT_FILTERS.every((f) => f.id !== "pending"));
  });

  it("picks the live class enrollment only", () => {
    const live = pickLiveEnrollment([
      { id: "1", status: "expired", year_id: "y1" },
      { id: "2", status: "active", year_id: "y2" },
    ]);
    assert.equal(live?.id, "2");
    assert.equal(pickLiveEnrollment([{ id: "1", status: "revoked", year_id: "y1" }]), null);
  });

  it("requires exam disposition only when blocking a live exam", () => {
    assert.equal(
      requiresExamDisposition({ nextStatus: "suspended", hasInProgressExam: true }),
      true
    );
    assert.equal(
      requiresExamDisposition({ nextStatus: "active", hasInProgressExam: true }),
      false
    );
    assert.equal(
      requiresExamDisposition({ nextStatus: "revoked", hasInProgressExam: false }),
      false
    );
  });

  it("blocks void without a reason", () => {
    assert.equal(
      canSubmitAccountStatusChange({
        nextStatus: "restricted",
        hasInProgressExam: true,
        disposition: "invalidate",
        reason: "   ",
      }),
      false
    );
    assert.equal(
      canSubmitAccountStatusChange({
        nextStatus: "restricted",
        hasInProgressExam: true,
        disposition: "leave_in_progress",
        reason: "",
      }),
      true
    );
  });

  it("never offers enrollment LMS-gate menu ids", () => {
    const active = studentManageMenuItems({
      accountStatus: "active",
      hasActiveClass: true,
      hasYearForResources: true,
    }).map((i) => i.id);
    const blocked = studentManageMenuItems({
      accountStatus: "revoked",
      hasActiveClass: false,
      hasYearForResources: false,
    }).map((i) => i.id);
    for (const id of FORBIDDEN_ENROLLMENT_LMS_GATE_IDS) {
      assert.equal(active.includes(id), false);
      assert.equal(blocked.includes(id), false);
    }
    assert.ok(active.includes("restrict_lms"));
    assert.ok(active.includes("promote_class"));
    assert.ok(active.includes("resource_access"));
    assert.deepEqual(blocked, ["restore_lms"]);
    assert.ok(EXAM_DISPOSITIONS.map((d) => d.id).includes("leave_in_progress"));
    assert.ok(BLOCKING_ACCOUNT_ACTIONS.every((a) => a.menuId.endsWith("_lms")));
  });

  it("maps RPC errors without leaking internals", () => {
    assert.match(
      accountStatusErrorMessage("attempt_disposition_required"),
      /exam in progress/i
    );
    assert.match(accountStatusErrorMessage("reason required"), /reason/i);
    assert.equal(
      accountStatusErrorMessage("relation does not exist"),
      "Could not update account access. Please try again."
    );
  });
});

describe("admin student surfaces do not use enrollment as LMS gate", () => {
  const files = [
    "src/app/(admin)/admin/students/student-actions.tsx",
    "src/app/(admin)/admin/students/page.tsx",
    "src/app/(admin)/admin/students/[id]/page.tsx",
    "src/app/(admin)/admin/page.tsx",
  ];

  it("does not call setEnrollmentStatus or show pending enrollment approval", () => {
    const base = path.resolve(".");
    for (const rel of files) {
      const src = fs.readFileSync(path.join(base, rel), "utf8");
      assert.doesNotMatch(src, /setEnrollmentStatus/);
      assert.doesNotMatch(src, /Pending approvals/);
      assert.doesNotMatch(src, /status=pending/);
      assert.doesNotMatch(src, /Approve this student's enrollment/i);
    }
  });
});
