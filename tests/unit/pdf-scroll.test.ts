import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSafePdfFixtureUrl,
  measurePageBases,
  pageAtScrollTop,
  placeholderSize,
  scrollTopAfterZoom,
} from "../../src/lib/study/pdf-scroll";

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

describe("continuous pdf scroll math", () => {
  const tops = [8, 808, 1608, 2408];

  it("maps scroll position to the page from first to last", () => {
    assert.equal(pageAtScrollTop(tops, 0, 0), 1);
    assert.equal(pageAtScrollTop(tops, 0, 300), 1);
    assert.equal(pageAtScrollTop(tops, 600, 300), 2);
    assert.equal(pageAtScrollTop(tops, 1600, 300), 3);
    assert.equal(pageAtScrollTop(tops, 2400, 300), 4);
    assert.equal(pageAtScrollTop([], 100, 0), 1);
  });

  it("is monotonic while scrolling down", () => {
    let last = 1;
    for (let y = 0; y <= 3000; y += 25) {
      const p = pageAtScrollTop(tops, y, 280);
      assert.ok(p >= last);
      last = p;
    }
    assert.equal(last, 4);
  });

  it("keeps reading place on zoom and sizes placeholders", () => {
    assert.equal(scrollTopAfterZoom(1000, 1, 2), 2000);
    assert.equal(scrollTopAfterZoom(1000, 0, 2), 1000);
    assert.deepEqual(placeholderSize({ width: 600, height: 800 }, 1.5), {
      width: 900,
      height: 1200,
    });
  });

  it("accepts only same-origin relative fixture URLs", () => {
    assert.equal(isSafePdfFixtureUrl("/offline/pdf-harness/fixture"), true);
    assert.equal(isSafePdfFixtureUrl("//evil.example/x"), false);
    assert.equal(isSafePdfFixtureUrl("https://evil.example/x"), false);
    assert.equal(isSafePdfFixtureUrl(undefined), false);
  });

  it("measures each page base independently (mixed sizes)", async () => {
    const sizes = [
      { width: 612, height: 792 },
      { width: 792, height: 612 },
      { width: 500, height: 1000 },
    ];
    const calls: number[] = [];
    const doc = {
      numPages: sizes.length,
      getPage: async (pageNumber: number) => {
        calls.push(pageNumber);
        const s = sizes[pageNumber - 1];
        return {
          getViewport: ({ scale }: { scale: number }) => ({
            width: s.width * scale,
            height: s.height * scale,
          }),
        };
      },
    };
    const bases = await measurePageBases(doc, 2);
    assert.deepEqual(bases, sizes);
    assert.deepEqual(calls.sort((a, b) => a - b), [1, 2, 3]);
  });
});

describe("pdf viewer continuous-scroll wiring", () => {
  const viewer = read("src", "components", "study", "pdf-viewer.tsx");
  const slot = read("src", "components", "study", "pdf-page-slot.tsx");
  const css = read("src", "styles", "pdf-text-layer.css");

  it("scroll surface allows one-finger vertical pan and has a fixed height", () => {
    const scrollRule = css.match(/\.pdf-viewer-scroll\s*\{[^}]*\}/)?.[0] ?? "";
    assert.match(scrollRule, /touch-action:\s*pan-x pan-y/);
    assert.doesNotMatch(scrollRule, /touch-action:\s*none/);
    assert.match(css, /\.pdf-viewer-root:not\(\.pdf-viewer-root--fs\)\s*\{[^}]*height:/);
    assert.match(viewer, /pdf-viewer-scroll[^"]*overflow-auto/);
  });

  it("touch handlers only intervene for two-finger pinch and defer decode", () => {
    assert.match(viewer, /e\.touches\.length !== 2/);
    assert.doesNotMatch(viewer, /onTouchMove=\{[^}]*scroll/i);
    // Pinch must not call setScale on every move (re-decode storm).
    assert.match(viewer, /is-pinch-preview/);
    assert.match(viewer, /liveScale/);
    assert.match(css, /\.pdf-page-column\.is-pinch-preview/);
  });

  it("renders all page slots but only decodes near-viewport pages", () => {
    assert.match(viewer, /Array\.from\(\{ length: pageCount \}/);
    assert.match(viewer, /measurePageBases/);
    assert.match(viewer, /pageBases\[i\]/);
    assert.match(slot, /IntersectionObserver/);
    assert.match(slot, /RENDER_ROOT_MARGIN/);
    // Off-screen pages release their canvas backing store.
    assert.match(slot, /canvas\.width = 0/);
    assert.match(slot, /canvas\.height = 0/);
    assert.doesNotMatch(slot, /actualBase/);
  });

  it("keeps prev/next, page jump, progress, highlights and retry", () => {
    assert.match(viewer, /scrollToPage\(target\)/);
    assert.match(viewer, /data-testid="pdf-prev"/);
    assert.match(viewer, /data-testid="pdf-next"/);
    assert.match(viewer, /data-testid="pdf-page-input"/);
    assert.match(viewer, /onScroll=\{onReaderScroll\}/);
    assert.match(viewer, /pageSaverRef\.current\?\.save\(page\)/);
    assert.match(viewer, /pageNumber: pendingHighlight\.pageNumber/);
    assert.match(viewer, /data-testid="pdf-loading"/);
    assert.match(viewer, /data-testid="pdf-error"/);
    assert.match(viewer, /loadDocument\(\{ preferOffline: false \}\)/);
    assert.match(slot, /pdf-highlight-mark/);
    assert.match(slot, /pdfjs\.TextLayer/);
  });
});
