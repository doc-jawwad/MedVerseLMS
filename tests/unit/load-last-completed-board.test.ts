import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadLastCompletedLeaderboardBoard,
  normalizeLeaderboardRpcRows,
} from "../../src/lib/leaderboard/load-last-completed-board.ts";
import { LEADERBOARD_PROJECTION_LIMITS } from "../../src/lib/leaderboard/projection-contract.ts";
import { resolveCollegeBackfill } from "../../src/lib/profile/college-backfill.ts";

const nowMs = Date.parse("2026-09-26T12:00:00Z");
const candidates = [
  {
    id: "test-closed",
    title: "Paeds Test 1",
    status: "published",
    closes_at: "2026-09-25T18:25:00Z",
  },
  {
    id: "test-open",
    title: "Still open",
    status: "published",
    closes_at: "2026-09-30T00:00:00Z",
  },
] as const;

const projectionRows = [
  {
    rank: 1,
    student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    full_name: "Ada Student",
    college_name: "King Edward Medical University",
    avatar_object_key: null,
    score: 95,
    email: "ada@secret.example",
  },
  {
    rank: 2,
    student_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    full_name: "Bea Student",
    college_name: "Allama Iqbal Medical College",
    avatar_object_key: null,
    score: 90,
  },
  {
    rank: 3,
    student_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    full_name: "Cy Student",
    college_name: null,
    avatar_object_key: null,
    score: 80,
  },
];

function mockRpc(handlers: Record<string, (args: unknown) => unknown>) {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    supabase: {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        const handler = handlers[name];
        if (!handler) {
          return {
            data: null,
            error: { message: `Could not find the function ${name}` },
          };
        }
        return handler(args);
      },
    },
  };
}

describe("normalizeLeaderboardRpcRows", () => {
  it("passes arrays through and parses jsonb strings", () => {
    assert.deepEqual(normalizeLeaderboardRpcRows([{ rank: 1 }]), [{ rank: 1 }]);
    assert.deepEqual(
      normalizeLeaderboardRpcRows(JSON.stringify([{ rank: 2, score: 1 }])),
      [{ rank: 2, score: 1 }]
    );
    assert.deepEqual(normalizeLeaderboardRpcRows(null), []);
    assert.deepEqual(normalizeLeaderboardRpcRows("{not-json"), []);
  });
});

describe("resolveCollegeBackfill", () => {
  it("heals blank profile from auth metadata without overwriting edits", () => {
    assert.equal(
      resolveCollegeBackfill(null, "King Edward Medical University"),
      "King Edward Medical University"
    );
    assert.equal(resolveCollegeBackfill("   ", "AIMC"), "AIMC");
    assert.equal(resolveCollegeBackfill("Edited College", "Auth College"), null);
    assert.equal(resolveCollegeBackfill(null, null), null);
    assert.equal(resolveCollegeBackfill(null, "  "), null);
  });
});

describe("loadLastCompletedLeaderboardBoard (historical Last test path)", () => {
  it("uses test_leaderboard_projection and displays each student's college", async () => {
    const { supabase, calls } = mockRpc({
      test_leaderboard_projection: () => ({
        data: projectionRows,
        error: null,
      }),
    });

    const board = await loadLastCompletedLeaderboardBoard(supabase as never, {
      candidates,
      nowMs,
      limit: LEADERBOARD_PROJECTION_LIMITS.dashboardFull,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.name, "test_leaderboard_projection");
    assert.deepEqual(calls[0]!.args, {
      p_test_id: "test-closed",
      p_limit: LEADERBOARD_PROJECTION_LIMITS.dashboardFull,
    });
    assert.equal(board.status, "ready");
    if (board.status !== "ready") return;
    assert.equal(board.testTitle, "Paeds Test 1");
    assert.deepEqual(
      board.rows.map((r) => r.college_name),
      [
        "King Edward Medical University",
        "Allama Iqbal Medical College",
        null,
      ]
    );
    assert.deepEqual(
      board.rows.map((r) => r.rank),
      [1, 2, 3]
    );
    assert.deepEqual(
      board.rows.map((r) => r.score),
      [95, 90, 80]
    );
    for (const row of board.rows) {
      assert.equal("email" in row, false);
      assert.equal("phone" in row, false);
      assert.equal("contact_number" in row, false);
    }
  });

  it("keeps College not set when projection college_name is blank", async () => {
    const { supabase } = mockRpc({
      test_leaderboard_projection: () => ({
        data: [
          {
            rank: 1,
            student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            full_name: "Ada",
            college_name: "   ",
            score: 10,
          },
        ],
        error: null,
      }),
    });
    const board = await loadLastCompletedLeaderboardBoard(supabase as never, {
      candidates,
      nowMs,
      limit: LEADERBOARD_PROJECTION_LIMITS.dashboardTop,
    });
    assert.equal(board.status, "ready");
    if (board.status === "ready") {
      assert.equal(board.rows[0]!.college_name, null);
    }
  });

  it("parses jsonb string payloads from projection without dropping colleges", async () => {
    const { supabase, calls } = mockRpc({
      test_leaderboard_projection: () => ({
        data: JSON.stringify(projectionRows),
        error: null,
      }),
    });
    const board = await loadLastCompletedLeaderboardBoard(supabase as never, {
      candidates,
      nowMs,
      limit: LEADERBOARD_PROJECTION_LIMITS.dashboardFull,
    });
    assert.equal(calls.some((c) => c.name === "test_leaderboard"), false);
    assert.equal(board.status, "ready");
    if (board.status === "ready") {
      assert.equal(
        board.rows[0]!.college_name,
        "King Edward Medical University"
      );
    }
  });

  it("does not call legacy test_leaderboard when projection succeeds", async () => {
    const { supabase, calls } = mockRpc({
      test_leaderboard_projection: () => ({
        data: projectionRows,
        error: null,
      }),
      test_leaderboard: () => {
        throw new Error("legacy path must not run");
      },
    });
    await loadLastCompletedLeaderboardBoard(supabase as never, {
      candidates,
      nowMs,
      limit: LEADERBOARD_PROJECTION_LIMITS.dashboardTop,
    });
    assert.deepEqual(
      calls.map((c) => c.name),
      ["test_leaderboard_projection"]
    );
  });

  it("legacy fallback has no college field (projection missing only)", async () => {
    const { supabase, calls } = mockRpc({
      test_leaderboard: () => ({
        data: [
          {
            rank: 1,
            student_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            full_name: "Ada",
            score: 11,
            email: "x@y.z",
          },
        ],
        error: null,
      }),
    });
    const board = await loadLastCompletedLeaderboardBoard(supabase as never, {
      candidates,
      nowMs,
      limit: LEADERBOARD_PROJECTION_LIMITS.dashboardTop,
    });
    assert.equal(calls[0]!.name, "test_leaderboard_projection");
    assert.equal(calls[1]!.name, "test_leaderboard");
    assert.equal(board.status, "ready");
    if (board.status === "ready") {
      assert.equal(board.rows[0]!.college_name, null);
      assert.equal(board.rows[0]!.score, 11);
      assert.equal("email" in board.rows[0]!, false);
    }
  });
});
