import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  attachAdminStudentDetails,
  mapAdminLeaderboardProfiles,
  type TestLeaderboardRankRow,
} from "../../src/lib/leaderboard/attach-admin-student-details.ts";
import { adaptTestLeaderboardRows } from "../../src/lib/leaderboard/from-test-leaderboard.ts";
import { LEADERBOARD_PROJECTION_LIMITS } from "../../src/lib/leaderboard/projection-contract.ts";

const ranks: TestLeaderboardRankRow[] = [
  {
    rank: 1,
    percentile: 99,
    student_id: "a",
    full_name: "Ada",
    score: 95,
    max_score: 100,
    percentage: 95,
    is_me: false,
  },
  {
    rank: 2,
    percentile: 50,
    student_id: "b",
    full_name: "Bea",
    score: 80,
    max_score: 100,
    percentage: 80,
    is_me: false,
  },
];

describe("admin leaderboard student details overlay", () => {
  it("keeps rank order and marks while attaching existing profile fields", () => {
    const details = mapAdminLeaderboardProfiles([
      {
        id: "a",
        college_name: "King Edward Medical University",
        email: "ada@example.com",
        account_status: "active",
        enrollments: [
          {
            id: "e1",
            status: "active",
            year_id: "y1",
            years: { name: "1st Year MBBS" },
          },
        ],
      },
      {
        id: "b",
        college_name: "  ",
        email: "bea@example.com",
        account_status: "restricted",
        enrollments: [],
      },
    ]);
    const rows = attachAdminStudentDetails(ranks, details);
    assert.deepEqual(
      rows.map((r) => r.rank),
      [1, 2]
    );
    assert.deepEqual(
      rows.map((r) => r.score),
      [95, 80]
    );
    assert.equal(rows[0]!.college_name, "King Edward Medical University");
    assert.equal(rows[0]!.email, "ada@example.com");
    assert.equal(rows[0]!.class_name, "1st Year MBBS");
    assert.equal(rows[0]!.class_status, "Current class");
    assert.equal(rows[0]!.account_status, "active");
    assert.equal(rows[1]!.college_name, null);
    assert.equal(rows[1]!.class_name, null);
    assert.equal(rows[1]!.email, "bea@example.com");
  });

  it("does not invent ranking when details are missing", () => {
    const rows = attachAdminStudentDetails(ranks, new Map());
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.rank, 1);
    assert.equal(rows[0]!.score, 95);
    assert.equal(rows[0]!.college_name, null);
    assert.equal(rows[0]!.email, null);
  });

  it("ignores contact and payment keys that must not appear on the overlay type", () => {
    const details = mapAdminLeaderboardProfiles([
      {
        id: "a",
        college_name: "KEMU",
        email: "ada@example.com",
        account_status: "active",
      },
    ]);
    const rows = attachAdminStudentDetails(ranks.slice(0, 1), details);
    const keys = Object.keys(rows[0]!);
    assert.equal(keys.includes("contact_number"), false);
    assert.equal(keys.includes("phone"), false);
    assert.equal(keys.includes("payment"), false);
    assert.equal(keys.includes("cnic"), false);
    assert.deepEqual(keys.sort(), [
      "account_status",
      "class_name",
      "class_status",
      "college_name",
      "email",
      "full_name",
      "is_me",
      "max_score",
      "percentage",
      "percentile",
      "rank",
      "score",
      "student_id",
    ]);
  });
});

describe("student-facing leaderboard privacy", () => {
  it("student projection still strips email even if admin overlay exists", () => {
    const rows = adaptTestLeaderboardRows(
      [
        {
          rank: 1,
          student_id: "a",
          full_name: "Ada",
          score: 95,
          college_name: "KEMU",
          email: "ada@example.com",
          account_status: "active",
          class_name: "1st Year MBBS",
        },
      ],
      LEADERBOARD_PROJECTION_LIMITS.dashboardFull
    );
    assert.equal("email" in rows[0]!, false);
    assert.equal("account_status" in rows[0]!, false);
    assert.equal("class_name" in rows[0]!, false);
    assert.equal(rows[0]!.college_name, "KEMU");
    assert.equal(rows[0]!.score, 95);
  });

  it("admin results page expands fields; student boards do not render email", () => {
    const root = process.cwd();
    const admin = readFileSync(
      path.join(root, "src/app/(admin)/admin/tests/[id]/results/page.tsx"),
      "utf8"
    );
    const studentResult = readFileSync(
      path.join(root, "src/app/(student)/tests/[id]/result/page.tsx"),
      "utf8"
    );
    const studentCard = readFileSync(
      path.join(root, "src/components/dashboard/leaderboard-board-card.tsx"),
      "utf8"
    );
    assert.match(admin, /attachAdminStudentDetails/);
    assert.match(admin, />College</);
    assert.match(admin, />Email</);
    assert.match(admin, />Class</);
    assert.doesNotMatch(studentResult, />Email</);
    assert.doesNotMatch(studentResult, />College</);
    assert.doesNotMatch(studentResult, /contact_number/);
    assert.doesNotMatch(studentCard, /email/i);
    assert.doesNotMatch(studentCard, /contact_number/);
    assert.match(studentCard, /college_name/);
  });
});
