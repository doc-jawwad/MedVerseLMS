import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  mergeNearbyRects,
  normalizeHighlightRects,
  pdfRectsToViewportBoxes,
} from "../../src/lib/study/pdf-highlight-geometry.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("pdf highlight geometry", () => {
  it("normalizes and merges PDF-space rects", () => {
    const rects = normalizeHighlightRects([
      { x1: 10, y1: 20, x2: 30, y2: 24 },
      { x1: 31, y1: 20.5, x2: 50, y2: 24.2 },
      { bad: true },
    ]);
    assert.equal(rects.length, 2);
    const merged = mergeNearbyRects(rects);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].x2 >= 50);
  });

  it("maps PDF rects through viewport convertToViewportRectangle", () => {
    const viewport = {
      width: 100,
      height: 200,
      convertToPdfPoint: (x: number, y: number) => [x, 200 - y],
      convertToViewportRectangle: (rect: number[]) => {
        const [x1, y1, x2, y2] = rect;
        return [x1, 200 - y2, x2, 200 - y1];
      },
    };
    const boxes = pdfRectsToViewportBoxes(viewport, [
      { x1: 10, y1: 10, x2: 40, y2: 30 },
    ]);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].width, 30);
    assert.equal(boxes[0].height, 20);
  });
});

describe("pdf reader ux wiring", () => {
  it("keeps range transport and mobile overlay chrome with pinch + highlights", () => {
    const viewer = fs.readFileSync(
      path.join(root, "src/components/study/pdf-viewer.tsx"),
      "utf8"
    );
    assert.match(viewer, /createOnlinePdfRangeTransport/);
    assert.match(viewer, /disableAutoFetch:\s*true/);
    assert.doesNotMatch(viewer, /getDocument\(\{\s*url:\s*sourceUrl/);
    assert.match(viewer, /TextLayer/);
    assert.match(viewer, /createPdfHighlight/);
    assert.match(viewer, /listPdfHighlights/);
    assert.match(viewer, /onTouchStart=\{onPinchStart\}/);
    assert.match(viewer, /pdf-fullscreen-close/);
    assert.match(viewer, /data-fullscreen/);
    assert.match(viewer, /pdf-prev/);
    assert.match(viewer, /pdf-next/);
    assert.match(viewer, /chromeVisible/);
    assert.match(viewer, /classList\.add\("pinching"\)/);
    assert.doesNotMatch(viewer, /localStorage\.setItem\([^)]*highlight/i);

    const mig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260926120000_pdf_highlights.sql"
      ),
      "utf8"
    );
    assert.match(mig, /create table public\.pdf_highlights/);
    assert.match(mig, /can_annotate_pdf/);
    assert.match(mig, /student_id = \(select auth\.uid\(\)\)/);

    const progressMig = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20261001030000_pdf_reading_progress.sql"
      ),
      "utf8"
    );
    assert.match(progressMig, /create table public\.pdf_reading_progress/);
    assert.match(progressMig, /can_annotate_pdf/);
  });
});
