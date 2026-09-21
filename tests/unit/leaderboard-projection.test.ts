import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptTestLeaderboardRow,
  adaptTestLeaderboardRows,
  projectionRowHasForbiddenKey,
  stripLeaderboardPrivateFields,
} from "../../src/lib/leaderboard/from-test-leaderboard.ts";
import { buildLeaderboardBoardState } from "../../src/lib/leaderboard/build-board-state.ts";
import { resolveLastCompletedTest } from "../../src/lib/leaderboard/resolve-last-completed-test.ts";
import {
  LEADERBOARD_PROJECTION_LIMITS,
  type LeaderboardProjectionRow,
} from "../../src/lib/leaderboard/projection-contract.ts";

const sampleRpc = {
  rank: 1,
  percentile: 99,
  student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  full_name: "Ada Student",
  score: 92.5,
  max_score: 100,
  percentage: 92.5,
  is_me: true,
  email: "secret@example.com",
  phone: "+10000000000",
};

describe("leaderboard projection adapter", () => {
  it("maps test_leaderboard rows to the safe projection contract", () => {
    const row = adaptTestLeaderboardRow(sampleRpc);
    assert.deepEqual(row, {
      rank: 1,
      student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      full_name: "Ada Student",
      college_name: null,
      avatar_object_key: null,
      score: 92.5,
    });
    assert.equal(projectionRowHasForbiddenKey(row!), false);
  });

  it("strips phone, email, and other private fields", () => {
    const cleaned = stripLeaderboardPrivateFields(sampleRpc);
    assert.ok(cleaned);
    assert.equal("email" in cleaned!, false);
    assert.equal("phone" in cleaned!, false);
    assert.equal(cleaned!.full_name, "Ada Student");
  });

  it("does not invent college or avatar when absent", () => {
    const row = adaptTestLeaderboardRow(sampleRpc);
    assert.equal(row?.college_name, null);
    assert.equal(row?.avatar_object_key, null);
  });

  it("passes through future college/avatar projection fields", () => {
    const row = adaptTestLeaderboardRow({
      ...sampleRpc,
      college_name: "King Edward Medical University",
      avatar_object_key: "avatars/aaa.png",
    });
    assert.equal(row?.college_name, "King Edward Medical University");
    assert.equal(row?.avatar_object_key, "avatars/aaa.png");
  });

  it("slices to Top 5 / Top 20 without re-sorting by score", () => {
    const raw = [
      { rank: 2, student_id: "b", full_name: "B", score: 80 },
      { rank: 1, student_id: "a", full_name: "A", score: 90 },
      { rank: 3, student_id: "c", full_name: "C", score: 70 },
      { rank: 4, student_id: "d", full_name: "D", score: 60 },
    ];
    // dashboardTop = 5; the fixture only has 4 rows so all 4 are returned
    const top5 = adaptTestLeaderboardRows(
      raw,
      LEADERBOARD_PROJECTION_LIMITS.dashboardTop
    );
    assert.equal(top5.length, 4); // fewer rows than limit — returns all
    assert.deepEqual(
      top5.map((r) => r.rank),
      [2, 1, 3, 4]
    );

    // dashboardFull = 20; same fixture
    const top20 = adaptTestLeaderboardRows(
      raw,
      LEADERBOARD_PROJECTION_LIMITS.dashboardFull
    );
    assert.equal(top20.length, 4);
  });

  it("rejects rows missing rank or score", () => {
    assert.equal(
      adaptTestLeaderboardRow({
        student_id: "x",
        full_name: "X",
        score: 10,
      }),
      null
    );
  });
});

describe("resolveLastCompletedTest", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");

  it("picks the most recently closed published test", () => {
    const resolved = resolveLastCompletedTest(
      [
        {
          id: "1",
          title: "Older",
          status: "published",
          closes_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "2",
          title: "Latest",
          status: "published",
          closes_at: "2026-09-18T00:00:00Z",
        },
        {
          id: "3",
          title: "Still open",
          status: "published",
          closes_at: "2026-09-25T00:00:00Z",
        },
      ],
      now
    );
    assert.equal(resolved?.id, "2");
    assert.equal(resolved?.title, "Latest");
  });

  it("returns null when no completed test exists", () => {
    assert.equal(
      resolveLastCompletedTest(
        [
          {
            id: "1",
            title: "Future",
            status: "published",
            closes_at: "2026-10-01T00:00:00Z",
          },
        ],
        now
      ),
      null
    );
  });
});

describe("buildLeaderboardBoardState", () => {
  const resolved = {
    id: "t1",
    title: "Block 4 GT",
    closesAt: "2026-09-18T00:00:00Z",
  };

  it("empty: no completed test", () => {
    const board = buildLeaderboardBoardState({
      resolved: null,
      rawRows: [],
      limit: 3,
    });
    assert.equal(board.status, "empty");
    if (board.status === "empty") {
      assert.equal(board.reason, "no_completed_test");
    }
  });

  it("empty: no ranking yet", () => {
    const board = buildLeaderboardBoardState({
      resolved,
      rawRows: [],
      limit: 3,
    });
    assert.equal(board.status, "empty");
    if (board.status === "empty") {
      assert.equal(board.reason, "no_ranking_yet");
    }
  });

  it("ready: Top N rows from rank_test-backed RPC", () => {
    const board = buildLeaderboardBoardState({
      resolved,
      rawRows: [
        {
          rank: 1,
          student_id: "a",
          full_name: "A",
          score: 10,
        },
      ],
      limit: 3,
    });
    assert.equal(board.status, "ready");
    if (board.status === "ready") {
      assert.equal(board.rows.length, 1);
      assert.equal(board.rows[0]!.score, 10);
      const allowed: (keyof LeaderboardProjectionRow)[] = [
        "rank",
        "student_id",
        "full_name",
        "college_name",
        "avatar_object_key",
        "score",
      ];
      assert.deepEqual(Object.keys(board.rows[0]!).sort(), allowed.sort());
    }
  });

  it("does not invent fake students when fetch fails", () => {
    const board = buildLeaderboardBoardState({
      resolved,
      rawRows: [{ rank: 1, student_id: "a", full_name: "A", score: 1 }],
      limit: 3,
      fetchFailed: true,
    });
    assert.equal(board.status, "empty");
    if (board.status === "empty") {
      assert.equal(board.reason, "unavailable");
    }
  });
});
