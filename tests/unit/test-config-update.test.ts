import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickTestConfigUpdate,
  TEST_CONFIG_UPDATE_KEYS,
} from "../../src/lib/tests/test-config-update.ts";

describe("pickTestConfigUpdate (L4)", () => {
  it("accepts allowlisted partials", () => {
    const picked = pickTestConfigUpdate({
      title: "Weekly",
      duration_minutes: 45,
      shuffle_questions: false,
    });
    assert.equal("error" in picked, false);
    if (!("error" in picked)) {
      assert.deepEqual(picked, {
        title: "Weekly",
        duration_minutes: 45,
        shuffle_questions: false,
      });
    }
  });

  it("rejects unknown / privilege-sensitive columns", () => {
    const sneaky = pickTestConfigUpdate({
      title: "ok",
      status: "published",
      tenant_id: "00000000-0000-0000-0000-000000000001",
    } as never);
    assert.deepEqual(sneaky, { error: "invalid_test_config_field" });
  });

  it("rejects empty updates", () => {
    assert.deepEqual(pickTestConfigUpdate({}), { error: "no_test_config_fields" });
  });

  it("covers the documented mutable field set", () => {
    assert.ok(TEST_CONFIG_UPDATE_KEYS.includes("title"));
    assert.ok(TEST_CONFIG_UPDATE_KEYS.includes("test_type"));
    assert.equal(TEST_CONFIG_UPDATE_KEYS.includes("status" as never), false);
  });
});
