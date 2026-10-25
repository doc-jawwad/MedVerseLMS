import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLinkingSubjectDefault } from "../../src/lib/admin/linking-subject-default.ts";

const FY = [
  { id: "med", name: "Medicine" },
  { id: "surg", name: "Surgery" },
  { id: "gyn", name: "Gynecology" },
  { id: "ped", name: "Pediatrics" },
];

describe("resolveLinkingSubjectDefault (Issue 10)", () => {
  it("does not default to Medicine (subjects[0]) when preferred is absent", () => {
    assert.equal(
      resolveLinkingSubjectDefault({ subjects: FY }),
      "",
      "empty preferred must not fall back to Medicine"
    );
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: null,
      }),
      ""
    );
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: "   ",
      }),
      ""
    );
  });

  it("defaults to the preferred day subject when it is in the option list", () => {
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: "surg",
      }),
      "surg"
    );
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: "ped",
      }),
      "ped"
    );
  });

  it("still accepts an explicit Medicine preference when it is the day subject", () => {
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: "med",
      }),
      "med"
    );
  });

  it("ignores a preferred id that is not in the subject options (no Medicine fallback)", () => {
    assert.equal(
      resolveLinkingSubjectDefault({
        subjects: FY,
        preferredSubjectId: "other-year-subject",
      }),
      ""
    );
  });

  it("wires day CSV import to preferredSubjectId instead of subjects[0]", () => {
    const root = join(process.cwd());
    const csv = readFileSync(
      join(
        root,
        "src/app/(admin)/admin/prof-session/[dayId]/day-practice-csv-import.tsx"
      ),
      "utf8"
    );
    const admin = readFileSync(
      join(
        root,
        "src/app/(admin)/admin/prof-session/[dayId]/day-content-admin.tsx"
      ),
      "utf8"
    );

    assert.match(csv, /resolveLinkingSubjectDefault/);
    assert.doesNotMatch(
      csv,
      /useState\(subjects\[0\]/,
      "CSV import must not default to subjects[0] (Medicine by sort_order)"
    );
    assert.match(csv, /preferredSubjectId/);
    assert.match(admin, /preferredSubjectId=\{subjectId\}/);
  });
});
