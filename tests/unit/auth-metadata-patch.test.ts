import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authMetadataPatch } from "../../src/lib/profile/auth-metadata-patch.ts";

describe("Auth metadata patch semantics", () => {
  it("sends an explicit null for removal instead of omitting the key", () => {
    assert.deepEqual(authMetadataPatch({ avatar_object_key: null }), {
      avatar_object_key: null,
    });
    assert.deepEqual(authMetadataPatch({ contact_number: "", college_name: null }), {
      contact_number: null,
      college_name: null,
    });
  });
  it("keeps supplied values and does not overwrite unrelated metadata", () => {
    assert.deepEqual(authMetadataPatch({ college_name: "Synthetic college" }), {
      college_name: "Synthetic college",
    });
  });
});
