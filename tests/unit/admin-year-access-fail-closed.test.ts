import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isAdminYearAccessRpcMissing,
  resolveAdminYearAccessDecision,
  resolveAdminYearsForCaller,
} from "../../src/lib/admin/year-access-decision.ts";

const Y1 = {
  id: "11111111-1111-4111-8111-111111111111",
  year_number: 1,
  name: "1st Year",
};
const Y2 = {
  id: "22222222-2222-4222-8222-222222222222",
  year_number: 2,
  name: "2nd Year",
};

describe("resolveAdminYearAccessDecision (M6 fail-closed)", () => {
  it("Main Admin always allowed", () => {
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: true,
        data: false,
        error: { message: "could not find the function" },
      }),
      true
    );
  });

  it("valid true/false RPC results decide correctly", () => {
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: true,
        error: null,
      }),
      true
    );
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: false,
        error: null,
      }),
      false
    );
  });

  it("missing RPC denies (never fail-open)", () => {
    const missing = { message: "Could not find the function public.admin_can_access_year", code: "PGRST202" };
    assert.equal(isAdminYearAccessRpcMissing(missing), true);
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: true,
        error: missing,
      }),
      false
    );
  });

  it("unavailable / other errors deny", () => {
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: null,
        error: { message: "network error" },
      }),
      false
    );
  });

  it("malformed / unusable data denies", () => {
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: null,
        error: null,
      }),
      false
    );
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: "true",
        error: null,
      }),
      false
    );
    assert.equal(
      resolveAdminYearAccessDecision({
        isMainAdmin: false,
        data: 1,
        error: null,
      }),
      false
    );
  });
});

describe("resolveAdminYearsForCaller (M5)", () => {
  it("Main Admin receives full year list", () => {
    const years = resolveAdminYearsForCaller({
      isMainAdmin: true,
      allYears: [Y1, Y2],
      assigned: null,
      assignmentError: { message: "could not find the function" },
    });
    assert.deepEqual(years, [Y1, Y2]);
  });

  it("assigned admin receives only assigned years", () => {
    const years = resolveAdminYearsForCaller({
      isMainAdmin: false,
      allYears: [Y1, Y2],
      assigned: [
        {
          admin_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          year_id: Y1.id,
          year_number: 1,
          year_name: "1st Year",
        },
      ],
      assignmentError: null,
    });
    assert.deepEqual(years, [Y1]);
  });

  it("assignment RPC missing/error returns empty (fail-closed)", () => {
    const years = resolveAdminYearsForCaller({
      isMainAdmin: false,
      allYears: [Y1, Y2],
      assigned: null,
      assignmentError: { message: "Could not find the function", code: "PGRST202" },
    });
    assert.deepEqual(years, []);
  });
});

describe("admin year loading wiring (source)", () => {
  it("admin layout uses loadAdminYearsForCaller", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(admin)/admin/layout.tsx"),
      "utf8"
    );
    assert.match(src, /loadAdminYearsForCaller/);
    assert.doesNotMatch(src, /\.from\("years"\)/);
  });

  it("adminCanAccessYear uses fail-closed resolver", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/admin/year-assignments.ts"),
      "utf8"
    );
    assert.match(src, /resolveAdminYearAccessDecision/);
    assert.doesNotMatch(src, /return true;\s*\/\/ Compat/);
    assert.doesNotMatch(src, /rpcMissing\(error\)\) \{\s*[\s\S]*return true/);
  });
});
