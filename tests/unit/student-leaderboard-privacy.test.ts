import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { adaptTestLeaderboardRows } from "../../src/lib/leaderboard/from-test-leaderboard.ts";
import { LEADERBOARD_PROJECTION_LIMITS } from "../../src/lib/leaderboard/projection-contract.ts";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("student leaderboard surfaces — privacy inventory", () => {
  it("dashboard last-test board uses the safe projection loader", () => {
    const section = read("src/components/dashboard/dashboard-leaderboard-section.tsx");
    const loader = read("src/lib/leaderboard/load-last-completed-board.ts");
    assert.match(section, /loadLastCompletedLeaderboardBoard/);
    assert.match(section, /Last test leaderboard/);
    assert.match(loader, /test_leaderboard_projection/);
  });

  it("student result board does not render admin-only fields", () => {
    const page = read("src/app/(student)/tests/[id]/result/page.tsx");
    assert.match(page, /rpc\("test_leaderboard"/);
    assert.match(page, /r\.full_name/);
    assert.match(page, /r\.score/);
    assert.doesNotMatch(page, /r\.email/);
    assert.doesNotMatch(page, /account_status/);
    assert.doesNotMatch(page, /contact_number/);
    assert.doesNotMatch(page, /LMS access/);
    assert.doesNotMatch(page, /attachAdminStudentDetails/);
  });

  it("dashboard board card renders name, college, score only", () => {
    const card = read("src/components/dashboard/leaderboard-board-card.tsx");
    assert.match(card, /row\.full_name/);
    assert.match(card, /row\.college_name/);
    assert.match(card, /row\.score/);
    assert.doesNotMatch(card, /row\.email/);
    assert.doesNotMatch(card, /account_status/);
    assert.doesNotMatch(card, /contact_number/);
    assert.doesNotMatch(card, /class_name/);
    assert.doesNotMatch(card, /LMS access/);
    assert.doesNotMatch(card, /attachAdminStudentDetails/);
  });

  it("historical dashboard is own lifetime stats, not a classmate board", () => {
    const hist = read("src/components/dashboard/dashboard-historical-section.tsx");
    assert.match(hist, /student_test_summary/);
    assert.doesNotMatch(hist, /test_leaderboard/);
    assert.doesNotMatch(hist, /attachAdminStudentDetails/);
  });

  it("no other student pages call leaderboard RPCs", () => {
    const testsIndex = read("src/app/(student)/tests/page.tsx");
    const performance = read("src/app/(student)/performance/page.tsx");
    assert.doesNotMatch(testsIndex, /test_leaderboard/);
    assert.match(performance, /redirect\("\/dashboard"\)/);
  });

  it("strips admin/private keys from student projection rows", () => {
    const rows = adaptTestLeaderboardRows(
      [
        {
          rank: 1,
          student_id: "a",
          full_name: "Ada",
          score: 88,
          college_name: "KEMU",
          email: "ada@example.com",
          account_status: "active",
          class_name: "1st Year MBBS",
          class_status: "Current class",
          contact_number: "03001234567",
          phone: "+92300",
          payment: { amount: 1 },
        },
      ],
      LEADERBOARD_PROJECTION_LIMITS.dashboardFull
    );
    assert.deepEqual(Object.keys(rows[0]!).sort(), [
      "avatar_object_key",
      "college_name",
      "full_name",
      "rank",
      "score",
      "student_id",
    ]);
    assert.equal(rows[0]!.college_name, "KEMU");
    assert.equal(rows[0]!.score, 88);
  });
});
