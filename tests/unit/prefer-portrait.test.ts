import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

describe("prefer portrait", () => {
  it("sets PWA manifest orientation to portrait", () => {
    const src = readFileSync(path.join(root, "src/app/manifest.ts"), "utf8");
    assert.match(src, /orientation:\s*"portrait"/);
    assert.doesNotMatch(src, /orientation:\s*"any"/);
  });

  it("wires runtime portrait preference into exam and practice sessions", () => {
    const attempt = readFileSync(
      path.join(root, "src/app/(student)/tests/[id]/attempt/attempt-client.tsx"),
      "utf8"
    );
    const practice = readFileSync(
      path.join(root, "src/components/practice/practice-mcq-session.tsx"),
      "utf8"
    );
    assert.match(attempt, /usePreferPortrait/);
    assert.match(practice, /usePreferPortrait/);
  });
});
