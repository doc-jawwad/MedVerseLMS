import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_SUBSCRIPTION_BROWSE_LIMIT,
  ADMIN_SUBSCRIPTION_SEARCH_ROW_LIMIT,
  adminStudentNameEmailOrFilter,
  adminSubscriptionMonthOptions,
  adminSubscriptionStudentScope,
  adminSubscriptionsHref,
  escapeIlikePattern,
  formatYearMonthLabel,
  matchesAdminSubscriptionFilters,
  normalizeAdminStudentSearchTerm,
  parseYearMonth,
  pktMonthUtcRange,
  serialNumber,
} from "../../src/lib/subscriptions/admin-list-query.ts";

describe("admin subscription month param", () => {
  it("parses YYYY-MM and treats all/empty as no filter", () => {
    assert.deepEqual(parseYearMonth("2026-10"), { year: 2026, month: 10 });
    assert.equal(parseYearMonth(""), null);
    assert.equal(parseYearMonth("all"), null);
    assert.equal(parseYearMonth("2026-13"), null);
    assert.equal(parseYearMonth("10-2026"), null);
  });

  it("uses Asia/Karachi calendar bounds for starts_at", () => {
    const oct = pktMonthUtcRange(2026, 10);
    assert.equal(oct.startIso, "2026-09-30T19:00:00.000Z");
    assert.equal(oct.endIso, "2026-10-31T19:00:00.000Z");
    const jan = pktMonthUtcRange(2027, 1);
    assert.equal(jan.startIso, "2026-12-31T19:00:00.000Z");
    assert.equal(jan.endIso, "2027-01-31T19:00:00.000Z");
  });

  it("includes a start at 00:00 PKT and excludes the next month", () => {
    const { startIso, endIso } = pktMonthUtcRange(2026, 10);
    const started = "2026-09-30T19:00:00.000Z";
    const lastTick = "2026-10-31T18:59:59.999Z";
    const nextMonth = "2026-10-31T19:00:00.000Z";
    assert.ok(started >= startIso && started < endIso);
    assert.ok(lastTick >= startIso && lastTick < endIso);
    assert.ok(!(nextMonth >= startIso && nextMonth < endIso));
  });
});

describe("admin subscription list filters and serials", () => {
  const rows = [
    {
      id: "a",
      isLive: true,
      displayStatus: "active",
      rowStatus: "active",
      fullName: "Ali Khan",
      email: "ali@example.com",
    },
    {
      id: "b",
      isLive: false,
      displayStatus: "expired",
      rowStatus: "expired",
      fullName: "Sara Ahmed",
      email: "sara@example.com",
    },
    {
      id: "c",
      isLive: false,
      displayStatus: "deactivated",
      rowStatus: "deactivated",
      fullName: "Ali Raza",
      email: "raza@example.com",
    },
  ];

  function apply(
    statusFilter: string | undefined,
    searchTerm: string | undefined
  ) {
    return rows
      .filter((r) =>
        matchesAdminSubscriptionFilters({
          statusFilter,
          searchTerm,
          isLive: r.isLive,
          displayStatus: r.displayStatus,
          rowStatus: r.rowStatus,
          fullName: r.fullName,
          email: r.email,
        })
      )
      .map((r, i) => ({ id: r.id, serial: serialNumber(i) }));
  }

  it("numbers the current filtered/sorted result set from 1", () => {
    assert.deepEqual(apply(undefined, undefined), [
      { id: "a", serial: 1 },
      { id: "b", serial: 2 },
      { id: "c", serial: 3 },
    ]);
  });

  it("renumbers after status filter", () => {
    assert.deepEqual(apply("expired", undefined), [{ id: "b", serial: 1 }]);
    assert.deepEqual(apply("active", undefined), [{ id: "a", serial: 1 }]);
    assert.deepEqual(apply("deactivated", undefined), [{ id: "c", serial: 1 }]);
  });

  it("applies search together with status and keeps serials dense", () => {
    assert.deepEqual(apply(undefined, "ali"), [
      { id: "a", serial: 1 },
      { id: "c", serial: 2 },
    ]);
    assert.deepEqual(apply("active", "ali"), [{ id: "a", serial: 1 }]);
    assert.deepEqual(apply("expired", "ali"), []);
  });

  it("counts matching rows (empty month = zero)", () => {
    assert.equal(apply("expired", "nope").length, 0);
  });

  it("skips name/email when search was already applied in the query", () => {
    const kept = matchesAdminSubscriptionFilters({
      statusFilter: undefined,
      searchTerm: "nobody",
      searchAppliedInQuery: true,
      isLive: true,
      displayStatus: "active",
      rowStatus: "active",
      fullName: "Ali Khan",
      email: "ali@example.com",
    });
    assert.equal(kept, true);
    const droppedByStatus = matchesAdminSubscriptionFilters({
      statusFilter: "expired",
      searchTerm: "nobody",
      searchAppliedInQuery: true,
      isLive: true,
      displayStatus: "active",
      rowStatus: "active",
      fullName: "Ali Khan",
      email: "ali@example.com",
    });
    assert.equal(droppedByStatus, false);
  });
});

describe("admin subscription DB student search scope", () => {
  it("normalizes blank search terms to undefined", () => {
    assert.equal(normalizeAdminStudentSearchTerm(undefined), undefined);
    assert.equal(normalizeAdminStudentSearchTerm("  "), undefined);
    assert.equal(normalizeAdminStudentSearchTerm(" Ali "), "ali");
  });

  it("escapes LIKE wildcards and builds a quoted or-filter", () => {
    assert.equal(escapeIlikePattern("a%b_c\\d"), "a\\%b\\_c\\\\d");
    assert.equal(
      adminStudentNameEmailOrFilter("ali"),
      'full_name.ilike."%ali%",email.ilike."%ali%"'
    );
    assert.equal(
      adminStudentNameEmailOrFilter('a,b"c'),
      'full_name.ilike."%a,b\\"c%",email.ilike."%a,b\\"c%"'
    );
  });

  it("uses browse limit when there is no search", () => {
    assert.deepEqual(
      adminSubscriptionStudentScope({ searchTerm: undefined }),
      { kind: "browse", limit: ADMIN_SUBSCRIPTION_BROWSE_LIMIT }
    );
  });

  it("returns empty when search matches no students (does not fall back to browse)", () => {
    assert.deepEqual(
      adminSubscriptionStudentScope({
        searchTerm: "ghost",
        matchedStudentIds: [],
      }),
      { kind: "empty" }
    );
    assert.deepEqual(
      adminSubscriptionStudentScope({
        searchTerm: "ghost",
        matchedStudentIds: null,
      }),
      { kind: "empty" }
    );
  });

  it("scopes by matched student ids so search is not limited to the browse window", () => {
    const scope = adminSubscriptionStudentScope({
      searchTerm: "ali",
      matchedStudentIds: ["s1", "s2"],
    });
    assert.deepEqual(scope, {
      kind: "byIds",
      studentIds: ["s1", "s2"],
      limit: ADMIN_SUBSCRIPTION_SEARCH_ROW_LIMIT,
    });
    assert.ok(
      scope.kind === "byIds" &&
        scope.limit > ADMIN_SUBSCRIPTION_BROWSE_LIMIT
    );
  });
});

describe("admin subscription hrefs and month options", () => {
  it("preserves year, status, search, and month", () => {
    assert.equal(
      adminSubscriptionsHref({ yearId: "y1" }),
      "/admin/subscriptions?year=y1"
    );
    assert.equal(
      adminSubscriptionsHref({
        yearId: "y1",
        status: "active",
        q: "ali",
        month: "2026-10",
      }),
      "/admin/subscriptions?year=y1&status=active&q=ali&month=2026-10"
    );
    assert.ok(
      !adminSubscriptionsHref({ yearId: "y1", month: "all" }).includes("month=")
    );
  });

  it("lists recent PKT months and keeps a selected older month", () => {
    const now = new Date("2026-10-06T09:00:00.000Z");
    const opts = adminSubscriptionMonthOptions(now, "2024-01", 3);
    assert.deepEqual(opts.slice(0, 3), ["2026-10", "2026-09", "2026-08"]);
    assert.ok(opts.includes("2024-01"));
    assert.equal(formatYearMonthLabel(2026, 10), "October 2026");
  });
});
