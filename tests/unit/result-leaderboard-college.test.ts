import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachCollegeToResultLeaderboard } from "../../src/lib/leaderboard/result-board.ts";

const ranks = [
  {
    rank: 2,
    student_id: "b",
    full_name: "Bea",
    score: 80,
    max_score: 100,
    percentage: 80,
    is_me: false,
  },
  {
    rank: 1,
    student_id: "a",
    full_name: "Ada",
    score: 95,
    max_score: 100,
    percentage: 95,
    is_me: true,
  },
];

describe("result leaderboard college overlay", () => {
  it("attaches college without reordering ranks or changing marks", () => {
    const rows = attachCollegeToResultLeaderboard(ranks, [
      {
        rank: 1,
        student_id: "a",
        full_name: "Ada",
        college_name: "King Edward Medical University",
        score: 95,
        email: "ada@example.com",
        account_status: "active",
      },
      {
        rank: 2,
        student_id: "b",
        full_name: "Bea",
        college_name: "Allama Iqbal Medical College",
        score: 80,
      },
    ]);
    assert.deepEqual(
      rows.map((r) => r.rank),
      [2, 1]
    );
    assert.deepEqual(
      rows.map((r) => r.score),
      [80, 95]
    );
    assert.equal(rows[0]!.percentage, 80);
    assert.equal(rows[0]!.max_score, 100);
    assert.equal(rows[0]!.college_name, "Allama Iqbal Medical College");
    assert.equal(rows[1]!.college_name, "King Edward Medical University");
    assert.equal(rows[1]!.is_me, true);
  });

  it("does not copy admin/private keys onto the result row", () => {
    const rows = attachCollegeToResultLeaderboard(ranks.slice(1), [
      {
        student_id: "a",
        college_name: "KEMU",
        email: "ada@example.com",
        account_status: "active",
        class_name: "1st Year MBBS",
        contact_number: "0300",
      },
    ]);
    assert.deepEqual(Object.keys(rows[0]!).sort(), [
      "college_name",
      "full_name",
      "is_me",
      "max_score",
      "percentage",
      "rank",
      "score",
    ]);
  });

  it("leaves college unset when projection has no match", () => {
    const rows = attachCollegeToResultLeaderboard(ranks, []);
    assert.equal(rows[0]!.college_name, null);
    assert.equal(rows[0]!.score, 80);
    assert.equal(rows[0]!.rank, 2);
  });
});
