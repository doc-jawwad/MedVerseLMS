import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { OSPE_PAGE_SIZE, OSPE_MAX_PAGE, ospePageWindow, ospePageRows, ospePageHref } from "../../src/lib/admin/ospe-pagination.ts";

describe("OSPE admin pagination", () => {
  it("uses bounded inclusive windows and an extra row", () => {
    assert.deepEqual(ospePageWindow(undefined), { page: 1, start: 0, end: 50 });
    assert.deepEqual(ospePageWindow("2"), { page: 2, start: 50, end: 100 });
    assert.deepEqual(ospePageWindow("5"), { page: 5, start: 200, end: 250 });
    const last = ospePageWindow(String(OSPE_MAX_PAGE));
    assert.equal(last.end - last.start, OSPE_PAGE_SIZE);
  });
  it("rejects malformed and excessive offsets", () => {
    for (const value of ["0", "-1", "1.5", "1e4", "Infinity", "10001", ["2"], null, {}, "9999999999"]) {
      assert.equal(ospePageWindow(value).page, 1);
    }
  });
  it("returns all 253 stations without gaps or duplicated sentinel rows", () => {
    const data = Array.from({ length: 253 }, (_, i) => i + 1);
    const found: number[] = [];
    for (let page = 1; page <= 6; page++) {
      const window = ospePageWindow(String(page));
      const result = ospePageRows(data.slice(window.start, window.end + 1));
      found.push(...result.rows);
      assert.equal(result.hasNext, page < 6);
    }
    assert.deepEqual(found, data);
    assert.deepEqual(ospePageRows([]), { rows: [], hasNext: false });
  });
  it("preserves class, search and valid status in navigation", () => {
    const link = new URL(ospePageHref({ year: "year-1", q: " Lung & heart ", status: "published" }, 6), "https://example.test");
    assert.equal(link.pathname, "/admin/ospe-stations");
    assert.equal(link.searchParams.get("year"), "year-1");
    assert.equal(link.searchParams.get("q"), "Lung & heart");
    assert.equal(link.searchParams.get("status"), "published");
    assert.equal(link.searchParams.get("page"), "6");
    assert.equal(ospePageHref({ year: "year-1", status: "invalid" }, 1), "/admin/ospe-stations?year=year-1");
  });
  it("retains class authorization, metadata selection and stable ordering", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("../../src/app/(admin)/admin/ospe-stations/page.tsx", import.meta.url)), "utf8");
    assert.match(source, /await requireAdmin\(\)/);
    assert.match(source, /return requireAdminClass\(/);
    assert.match(source, /\.eq\("year_id", yearId\)/);
    assert.match(source, /\.is\("deleted_at", null\)/);
    assert.match(source, /\.order\("sort_order"\)[\s\S]*?\.order\("created_at", \{ ascending: false \}\)[\s\S]*?\.order\("id"\)[\s\S]*?\.range\(window.start, window.end\)/);
    assert.doesNotMatch(source, /\.limit\(200\)/);
    const select = source.match(/\.select\(\s*"([^"]+)"/)?.[1] ?? "";
    assert.ok(select.includes("id, title, status, entitlement"));
    assert.doesNotMatch(select, /answer|r2_/);
    assert.match(source, /role="alert"/);
  });
});
