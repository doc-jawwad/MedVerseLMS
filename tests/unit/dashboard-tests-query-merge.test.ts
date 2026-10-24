import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DASHBOARD_UPCOMING_LIMIT,
  deriveDashboardUpcomingFromCatalog,
  pickIncomingWithState,
} from "../../src/lib/dashboard/derive-upcoming-from-catalog.ts";
import {
  classifyCatalogTestStates,
  isIncomingDashboardTest,
} from "../../src/lib/tests/student-test-state.ts";

/**
 * Dashboard Performance v2 — single /tests fetch + in-memory upcoming derive.
 */
describe("dashboard tests query merge (v2)", () => {
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(student)/dashboard/page.tsx"),
    "utf8"
  );

  it("executes only one tests table fetch in the dashboard fan-out", () => {
    const fromTests = page.match(/\.from\(\s*["']tests["']\s*\)/g) ?? [];
    assert.equal(
      fromTests.length,
      1,
      `expected exactly one .from("tests"), found ${fromTests.length}`
    );
    assert.match(page, /deriveDashboardUpcomingFromCatalog/);
  });

  it("keeps catalog authorization via RLS-visible select (no app-side status bypass)", () => {
    // Single fetch must not invent rows: no service-role / admin client on page.
    assert.doesNotMatch(page, /createAdminClient|service_role/);
    // Upcoming filter still requires published + open window in-process.
    assert.match(
      page,
      /deriveDashboardUpcomingFromCatalog\(\s*catalogTests/
    );
  });
});

describe("deriveDashboardUpcomingFromCatalog", () => {
  const base = {
    id: "t",
    title: "T",
    entitlement: "free" as string | null,
  };

  it("matches published + closes_at > now filter, limit, and opens_at ASC NULLS FIRST", () => {
    const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
    const catalog = [
      {
        ...base,
        id: "closed",
        status: "published",
        opens_at: "2026-10-01T00:00:00.000Z",
        closes_at: "2026-10-02T00:00:00.000Z",
      },
      {
        ...base,
        id: "draftish",
        status: "closed",
        opens_at: "2026-10-04T00:00:00.000Z",
        closes_at: "2026-10-10T00:00:00.000Z",
      },
      {
        ...base,
        id: "null-opens",
        status: "published",
        opens_at: null,
        closes_at: "2026-10-20T00:00:00.000Z",
      },
      {
        ...base,
        id: "later",
        status: "published",
        opens_at: "2026-10-05T00:00:00.000Z",
        closes_at: "2026-10-20T00:00:00.000Z",
      },
      {
        ...base,
        id: "earlier",
        status: "published",
        opens_at: "2026-10-04T00:00:00.000Z",
        closes_at: "2026-10-20T00:00:00.000Z",
      },
    ];

    const upcoming = deriveDashboardUpcomingFromCatalog(catalog, nowMs);
    assert.deepEqual(
      upcoming.map((t) => t.id),
      ["null-opens", "earlier", "later"]
    );
  });

  it("applies the same limit 20 as the previous PostgREST query", () => {
    const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
    const catalog = Array.from({ length: 25 }, (_, i) => ({
      id: `t${i}`,
      title: `T${i}`,
      status: "published",
      opens_at: new Date(Date.UTC(2026, 9, 4 + i)).toISOString(),
      closes_at: "2026-12-01T00:00:00.000Z",
      entitlement: "free",
    }));
    const upcoming = deriveDashboardUpcomingFromCatalog(catalog, nowMs);
    assert.equal(upcoming.length, DASHBOARD_UPCOMING_LIMIT);
    assert.equal(upcoming[0]!.id, "t0");
    assert.equal(upcoming[19]!.id, "t19");
  });

  it("does not surface non-published catalog rows in upcoming", () => {
    const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
    const upcoming = deriveDashboardUpcomingFromCatalog(
      [
        {
          id: "closed-window-ok",
          status: "closed",
          opens_at: "2026-09-01T00:00:00.000Z",
          closes_at: "2026-09-02T00:00:00.000Z",
          entitlement: "free",
        },
        {
          id: "live",
          status: "published",
          opens_at: "2026-10-04T00:00:00.000Z",
          closes_at: "2026-10-20T00:00:00.000Z",
          entitlement: "any_subscription",
        },
      ],
      nowMs
    );
    assert.deepEqual(
      upcoming.map((t) => t.id),
      ["live"]
    );
  });

  it("preserves catalog identity for secondary consumers (no drop of closed tests)", () => {
    // Documented contract: catalog/secondary uses the full single fetch;
    // derivation must not mutate the source array.
    const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
    const catalog = [
      {
        id: "past",
        status: "closed",
        opens_at: "2026-01-01T00:00:00.000Z",
        closes_at: "2026-01-02T00:00:00.000Z",
        entitlement: "free",
      },
      {
        id: "future",
        status: "published",
        opens_at: "2026-10-10T00:00:00.000Z",
        closes_at: "2026-10-20T00:00:00.000Z",
        entitlement: "free",
      },
    ];
    const before = catalog.map((t) => t.id);
    deriveDashboardUpcomingFromCatalog(catalog, nowMs);
    assert.deepEqual(
      catalog.map((t) => t.id),
      before
    );
  });
});

describe("pickIncomingWithState", () => {
  it("caps after the incoming filter so finished tests do not push open tests off", () => {
    const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
    // 20 older tests the student already submitted (still inside window),
    // followed by one open paid test that opened later.
    const catalog = [
      ...Array.from({ length: DASHBOARD_UPCOMING_LIMIT }, (_, i) => ({
        id: `done${i}`,
        status: "published",
        opens_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
        closes_at: "2026-12-01T00:00:00.000Z",
        entitlement: "any_subscription",
      })),
      {
        id: "open-paid",
        status: "published",
        opens_at: "2026-10-02T00:00:00.000Z",
        closes_at: "2026-12-01T00:00:00.000Z",
        entitlement: "any_subscription",
      },
    ];
    const upcoming = deriveDashboardUpcomingFromCatalog(
      catalog,
      nowMs,
      Number.POSITIVE_INFINITY
    );
    const states = classifyCatalogTestStates({
      nowMs,
      tests: upcoming,
      attempts: upcoming
        .filter((t) => t.id.startsWith("done"))
        .map((t) => ({ test_id: t.id, state: "submitted" })),
      accessibleIds: upcoming.map((t) => t.id),
      subscriptions: [],
      grants: [],
    });
    const picked = pickIncomingWithState(
      upcoming,
      states,
      isIncomingDashboardTest
    );
    assert.deepEqual(
      picked.map((p) => p.t.id),
      ["open-paid"]
    );
    assert.equal(picked[0]!.state, "available");
  });
});
