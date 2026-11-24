import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { SESSION_WATCH_POLL_MS } from "../../src/lib/auth/session-watch.ts";

it("polls the session decision without reading the stored session ID", () => {
  assert.ok(SESSION_WATCH_POLL_MS >= 5_000);
  assert.ok(SESSION_WATCH_POLL_MS <= 60_000);
  const watch = readFileSync(
    new URL("../../src/components/session-watch.tsx", import.meta.url),
    "utf8"
  );
  assert.match(watch, /rpc\("current_session_id",\s*\{\s*p_require_token_session: true/);
  assert.match(watch, /rpc\("owns_live_attempt_session"\)/);
  assert.doesNotMatch(watch, /active_session_id/);
});
