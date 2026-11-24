import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDirectoryParams, directoryHref, directoryNamePattern } from "../../src/lib/admin/student-directory-params.ts";

describe("student directory paging", () => {
  it("bounds page, offset and query length", () => {
    assert.deepEqual(normalizeDirectoryParams({q:"  test  ",account:"blocked",page:"3"}),{q:"test",account:"blocked",page:3,offset:100});
    assert.equal(normalizeDirectoryParams({page:"99999"}).offset,499950);
    assert.equal(normalizeDirectoryParams({page:"-1",account:"invalid"}).page,1);
    assert.equal(normalizeDirectoryParams({q:"x".repeat(300)}).q.length,254);
    assert.deepEqual(normalizeDirectoryParams({q:["a","b"],page:["1"]}),{q:"",account:"",page:1,offset:0});
  });
  it("escapes LIKE metacharacters for name-only search", () => {
    assert.equal(directoryNamePattern("a%b_c"),"%a\\%b\\_c%");
  });
  it("preserves filters in page links", () => {
    assert.equal(directoryHref("a+b@example.invalid","blocked",2),"/admin/students?q=a%2Bb%40example.invalid&account=blocked&page=2");
    assert.equal(directoryHref("","",1),"/admin/students");
  });
});
