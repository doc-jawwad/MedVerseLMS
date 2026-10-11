import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

describe("dashboard leaderboard mobile layout", () => {
  it("uses a responsive grid that keeps score visible and truncates college", () => {
    const src = readFileSync(
      path.join(root, "src/components/dashboard/leaderboard-board-card.tsx"),
      "utf8"
    );
    assert.match(src, /grid-cols-\[2rem_minmax\(0,1fr\)_auto\]/);
    assert.match(src, /data-testid="leaderboard-score"/);
    assert.match(src, /line-clamp-2/);
    assert.match(src, /min-w-0/);
  });
});
