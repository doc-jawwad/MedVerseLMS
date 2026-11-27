import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { matchesOspeBulkReplay, ospeBulkBatchError, validateOspeBulkItem } from "../../src/lib/admin/ospe-bulk.ts";

const requestId = "2aa55ccd-1b94-4eb7-9e23-0a4a90000001";
const item = { requestId, title: "Station", answer: "Answer", sortOrder: 0 };
describe("OSPE bulk draft import", () => {
  it("validates IDs, text and order", () => {
    assert.equal(validateOspeBulkItem(item), null);
    for (const bad of [{ requestId: "bad" }, { title: " " }, { answer: "" }, { title: "x".repeat(201) },
      { answer: "x".repeat(20001) }, { sortOrder: -1 }, { sortOrder: 0.5 }, { sortOrder: Infinity }]) {
      assert.ok(validateOspeBulkItem({ ...item, ...bad }));
    }
  });
  it("bounds number and total bytes", () => {
    assert.equal(ospeBulkBatchError(Array(20).fill(5 * 1024 * 1024)), null);
    for (const bad of [[], Array(21).fill(1), [0], [101 * 1024 * 1024], [NaN]]) assert.ok(ospeBulkBatchError(bad));
  });
  it("only reconciles the same creator, class, subject and draft metadata", () => {
    const expected = { ...item, userId: "u", yearId: "y", subjectId: "s", contentType: "image/webp", byteSize: 42 };
    const row = { id: requestId, created_by: "u", year_id: "y", subject_id: "s", title: item.title,
      answer: item.answer, status: "draft", sort_order: 0, r2_content_type: "image/webp", r2_byte_size: 42 };
    assert.equal(matchesOspeBulkReplay(row, expected), true);
    for (const changed of [{ id: "other" }, { created_by: "other" }, { year_id: "other" },
      { subject_id: "other" }, { answer: "other" }, { status: "published" }, { r2_byte_size: 43 }]) {
      assert.equal(matchesOspeBulkReplay({ ...row, ...changed }, expected), false);
    }
    assert.equal(matchesOspeBulkReplay(null, expected), false);
  });
  it("keeps private upload and class gates ahead of insertion", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("../../src/lib/actions/ospe-stations.ts", import.meta.url)), "utf8");
    const create = source.slice(source.indexOf("async function createOspeStationRecord"), source.indexOf("export async function updateOspeStation"));
    assert.match(create, /!requestId && String\(formData.get\("status"\)/);
    assert.ok(create.indexOf('rpc("admin_can_access_year"') < create.indexOf("await allocateStudyObjectKey()"));
    assert.ok(create.indexOf("matchesOspeBulkReplay") < create.indexOf("await allocateStudyObjectKey()"));
    assert.match(create, /\.\.\.\(requestId \? \{ id: requestId \}/);
    assert.match(source, /function isDefinitiveDbRejection[\s\S]*?\/\^\(22\|23\|42\)/);
    assert.match(create, /const rejected = isDefinitiveDbRejection\(error\);\s*if \(rejected\) await discardStudyKey\(supabase, key\)/);
    assert.doesNotMatch(create, /!requestId \|\|/);
    const update = source.slice(source.indexOf("export async function updateOspeStation"), source.indexOf("export async function setOspeStationStatus"));
    assert.ok(update.indexOf("subject.data?.year_id !== yearId") < update.indexOf("await allocateStudyObjectKey()"));
  });
});
