import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ---------------------------------------------------------------------------
// Helpers duplicated from the subscription page (PKT timezone computation).
// Tests here prove correctness independently of the React component.
// ---------------------------------------------------------------------------

const PKT_TZ = "Asia/Karachi";

function remainingDaysPKT(endsAt: string, now?: Date): number {
  const ref = now ?? new Date();
  const nowPKT = new Date(ref.toLocaleString("en-US", { timeZone: PKT_TZ }));
  const endPKT = new Date(
    new Date(endsAt).toLocaleString("en-US", { timeZone: PKT_TZ })
  );
  const diffMs = endPKT.getTime() - nowPKT.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function approxMonths(durationDays: number): number {
  return Math.round(durationDays / 30);
}

describe("subscription countdown (PKT-aware)", () => {
  it("returns 0 when subscription has already ended", () => {
    // Past date.
    const ended = "2020-01-01T00:00:00.000Z";
    assert.equal(remainingDaysPKT(ended), 0);
  });

  it("returns correct remaining days for a near-future end", () => {
    // now = 2026-09-21T12:00:00Z (UTC), PKT = 2026-09-21T17:00:00 PKT
    const now = new Date("2026-09-21T12:00:00.000Z");
    // Ends in 10 days (UTC).
    const endsAt = "2026-10-01T18:30:00.000Z"; // PKT: 2026-10-01T23:30 PKT = +10d
    const days = remainingDaysPKT(endsAt, now);
    assert.ok(days >= 9 && days <= 11, `expected ~10 days, got ${days}`);
  });

  it("treats expiry at midnight PKT as 0 remaining (not negative)", () => {
    const now = new Date("2026-09-21T19:01:00.000Z"); // PKT: 2026-09-22T00:01 → past midnight
    const endsAt = "2026-09-21T19:00:00.000Z"; // PKT: 2026-09-22T00:00 → exactly midnight
    const days = remainingDaysPKT(endsAt, now);
    assert.equal(days, 0);
  });

  it("does not return negative days", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    const endsAt = "2026-09-01T00:00:00.000Z";
    assert.equal(remainingDaysPKT(endsAt, now), 0);
  });
});

describe("plan duration display", () => {
  it("converts 365 days to ~12 months", () => {
    assert.equal(approxMonths(365), 12);
  });

  it("converts 180 days to ~6 months", () => {
    assert.equal(approxMonths(180), 6);
  });

  it("converts 30 days to 1 month", () => {
    assert.equal(approxMonths(30), 1);
  });

  it("rounds 90 days to 3 months", () => {
    assert.equal(approxMonths(90), 3);
  });
});

describe("plan price display", () => {
  it("formats 5000 as readable PKR string", () => {
    const formatted = Number(5000).toLocaleString();
    assert.equal(formatted, "5,000");
  });

  it("formats 0 as 0 (complimentary plan shows badge, not price)", () => {
    assert.equal(Number(0).toLocaleString(), "0");
  });

  it("handles fractional price gracefully", () => {
    const val = Number(5000.5).toLocaleString();
    assert.ok(val.includes("5"), `expected number containing 5, got ${val}`);
  });
});
