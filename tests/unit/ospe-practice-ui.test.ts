import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isOspeStationImageFile,
  OSPE_STATION_IMAGE_MAX_BYTES,
} from "../../src/lib/study/upload-rules.ts";
import { studyErrorMessage } from "../../src/lib/study/errors.ts";
import {
  fromSpineItemKind,
  toSpineItemKind,
} from "../../src/lib/practice/spine-progress-store.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("OSPE Practice UI security wiring", () => {
  it("catalog page selects metadata columns only (no answer / r2_*)", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/library/ospe-practice-library-page.tsx"),
      "utf8"
    );
    const selectMatch = src.match(/\.select\(\s*"([\s\S]*?)"\s*\)/);
    assert.ok(selectMatch, "expected catalog select");
    const cols = selectMatch![1]!;
    assert.ok(cols.includes("title"));
    assert.ok(cols.includes("entitlement"));
    assert.ok(cols.includes("sort_order"));
    assert.equal(cols.includes("answer"), false);
    assert.equal(cols.includes("r2_object_key"), false);
    assert.equal(cols.includes("r2_content_type"), false);
    assert.equal(cols.includes("r2_byte_size"), false);
    assert.equal(cols.includes("created_by"), false);
  });

  it("student session never embeds answer before reveal RPC", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/practice/ospe-practice-session.tsx"),
      "utf8"
    );
    assert.match(src, /openOspeStation/);
    assert.match(src, /itemKind:\s*"ospe"/);
    assert.match(src, /\/api\/ospe-stations\//);
    assert.equal(src.includes("has_practice_access"), false);
    assert.equal(/answer:\s*["']/.test(src), false);
  });

  it("image API authorizes then streams private bytes (no signed URL to client)", () => {
    const src = fs.readFileSync(
      path.join(root, "src/app/api/ospe-stations/[stationId]/route.ts"),
      "utf8"
    );
    assert.match(src, /authorize_ospe_station_object/);
    assert.match(src, /getR2Object/);
    assert.match(src, /private, no-store/);
    assert.equal(src.includes("presignR2Object"), false);
    assert.equal(src.includes("r2.dev"), false);
  });

  it("openOspeStation action returns answer fields only from RPC", () => {
    const src = fs.readFileSync(
      path.join(root, "src/lib/actions/ospe-stations.ts"),
      "utf8"
    );
    assert.match(src, /open_ospe_station/);
    assert.match(src, /allocate_study_object_key|allocateStudyObjectKey/);
    assert.match(src, /authorize_study_object_discard/);
    assert.match(src, /get_ospe_station_for_admin/);
    assert.equal(src.includes("has_practice_access"), false);
    assert.equal(src.includes("test_attempts"), false);
  });

  it("accepts JPEG/PNG/WebP within size limit", () => {
    assert.equal(
      isOspeStationImageFile({ type: "image/jpeg", size: 1024 }),
      null
    );
    assert.equal(
      isOspeStationImageFile({ type: "image/png", size: 2048 }),
      null
    );
    assert.equal(
      isOspeStationImageFile({ type: "image/webp", size: 4096 }),
      null
    );
    assert.equal(
      isOspeStationImageFile({ type: "application/pdf", size: 1024 }),
      "ospe_image_type_invalid"
    );
    assert.equal(
      isOspeStationImageFile({
        type: "image/jpeg",
        size: OSPE_STATION_IMAGE_MAX_BYTES + 1,
      }),
      "ospe_image_too_large"
    );
  });

  it("maps ospe progress kinds and error copy", () => {
    assert.equal(toSpineItemKind("ospe"), "ospe");
    assert.equal(fromSpineItemKind("ospe"), "ospe");
    assert.match(studyErrorMessage("ospe_access_denied"), /OSPE station/i);
    assert.match(studyErrorMessage("ospe_object_denied"), /station image/i);
  });
});
